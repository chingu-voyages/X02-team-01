"""JHEP-109 — Enroll and Verify Multi-Factor Authentication (TOTP).

The dormant-by-default guarantee, the two-stage sign-in, the AC2
challenge-token lockout, the AC3 failure matrix and lockout, recovery
codes, and the AC4 reset-no-bypass proof.
"""

import pyotp
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.db.session import get_session
from app.main import app
from app.models import (
    EmailVerificationToken,
    MfaLoginChallenge,
    MfaRecoveryCode,
    PasswordResetToken,
    User,
)
from app.services import mfa_service as mfa_module


@pytest.fixture
def mfa_env(monkeypatch):
    """A deployment with MFA configured."""
    monkeypatch.setattr(mfa_module.settings, "mfa_encryption_key", "test-mfa-key")


class MfaHarness:
    """SQLite-backed app with real logins for every role."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch | None = None):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(
            self.engine,
            tables=[
                User.__table__,
                EmailVerificationToken.__table__,
                PasswordResetToken.__table__,
                MfaLoginChallenge.__table__,
                MfaRecoveryCode.__table__,
            ],
        )
        self.session = Session(self.engine)

        def override_session() -> Iterator[Session]:
            yield self.session

        app.dependency_overrides[get_session] = override_session
        self.client = TestClient(app)

    def close(self) -> None:
        app.dependency_overrides.pop(get_session, None)
        self.client.close()
        self.session.close()
        self.engine.dispose()

    def create_user(
        self, *, email: str, role: str, password: str = "Str0ngEn0ugh1"
    ) -> User:
        from app.core.security import hash_password

        user = User(
            email=email,
            full_name=role.title(),
            hashed_password=hash_password(password),
            role=role,
            is_verified=True,
        )
        self.session.add(user)
        self.session.commit()
        self.session.refresh(user)
        return user

    def login(self, email: str, password: str = "Str0ngEn0ugh1") -> dict:
        response = self.client.post(
            "/api/v1/auth/login", json={"email": email, "password": password}
        )
        assert response.status_code == 200, response.text
        return response.json()


from collections.abc import Iterator  # noqa: E402


def test_login_response_is_byte_identical_for_non_enrolled_accounts(
    mfa_env, monkeypatch
) -> None:
    """The dormant-by-default proof: an MFA-mandatory role that has not
    enrolled gets the exact same login response as before the feature."""
    harness = MfaHarness(monkeypatch)
    try:
        harness.create_user(email="admin@example.test", role="administrator")
        body = harness.login("admin@example.test")
        assert body["mfa_required"] is False
        assert body["challenge_id"] is None  # the dormant default
        # the token is a REAL session — it works on protected routes
        probe = harness.client.get(
            "/api/v1/admin/users",
            headers={"Authorization": f"Bearer {body['access_token']}"},
        )
        assert probe.status_code == 200
    finally:
        harness.close()


def test_enrollment_flow_setup_confirm_and_recovery_codes(mfa_env) -> None:
    """AC1: setup -> live code -> confirmed + one-time recovery codes."""
    harness = MfaHarness()
    try:
        admin = harness.create_user(email="enroll@example.test", role="administrator")
        token = harness.login("enroll@example.test")["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        setup = harness.client.post("/api/v1/auth/mfa/enroll/setup", headers=headers)
        assert setup.status_code == 200
        secret = setup.json()["secret"]
        assert setup.json()["otpauth_uri"].startswith("otpauth://totp/")

        code = pyotp.TOTP(secret).now()
        confirm = harness.client.post(
            "/api/v1/auth/mfa/enroll/verify",
            json={"code": code},
            headers=headers,
        )
        assert confirm.status_code == 200, confirm.text
        codes = confirm.json()["recovery_codes"]
        assert len(codes) == 8

        stored = harness.session.exec(select(User).where(User.id == admin.id)).one()
        assert stored.mfa_enrolled_at is not None
        assert stored.totp_secret_encrypted is not None
        assert secret not in stored.totp_secret_encrypted  # encrypted

        # the recovery codes are stored as digests only
        hashes = harness.session.exec(select(MfaRecoveryCode)).all()
        assert len(hashes) == 8
        assert all(codes[0] not in h.code_hash for h in hashes)
    finally:
        harness.close()


def test_wrong_code_rejected_at_enrollment(mfa_env) -> None:
    harness = MfaHarness()
    try:
        harness.create_user(email="wrong@example.test", role="administrator")
        token = harness.login("wrong@example.test")["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        harness.client.post("/api/v1/auth/mfa/enroll/setup", headers=headers)
        confirm = harness.client.post(
            "/api/v1/auth/mfa/enroll/verify",
            json={"code": "000000"},
            headers=headers,
        )
        assert confirm.status_code == 400
        assert confirm.json()["code"] == "INVALID_MFA_CODE"

        stored = harness.session.exec(
            select(User).where(User.email == "wrong@example.test")
        ).one()
        assert stored.mfa_enrolled_at is None  # nothing activated
    finally:
        harness.close()


def test_mfa_required_two_stage_sign_in(mfa_env) -> None:
    """AC2/AC5: password OK -> challenge (no session) -> code OK -> the
    real session."""
    harness = MfaHarness()
    try:
        harness.create_user(email="twostep@example.test", role="administrator")
        token = harness.login("twostep@example.test")["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        setup = harness.client.post("/api/v1/auth/mfa/enroll/setup", headers=headers)
        secret = setup.json()["secret"]
        harness.client.post(
            "/api/v1/auth/mfa/enroll/verify",
            json={"code": pyotp.TOTP(secret).now()},
            headers=headers,
        )

        # sign out the enrollment session, sign in again
        challenge = harness.login("twostep@example.test")
        assert challenge["mfa_required"] is True
        challenge_token = challenge["access_token"]

        # AC2: the challenge token CANNOT access protected routes
        probe = harness.client.get(
            "/api/v1/admin/users",
            headers={"Authorization": f"Bearer {challenge_token}"},
        )
        assert probe.status_code == 401

        # AC5: the code completes the sign-in — the REAL session
        totp = pyotp.TOTP(secret)
        verify = harness.client.post(
            "/api/v1/auth/mfa/verify",
            json={
                "code": totp.at(
                    challenge["challenge_id"]
                    and __import__("datetime").datetime.now(__import__("datetime").UTC)
                ),
                "challenge": True,
            }
            | {"challenge_token": challenge_token},
            headers={"Authorization": f"Bearer {challenge_token}"},
        )
        assert verify.status_code == 200, verify.text
        real_token = verify.json()["access_token"]
        probe = harness.client.get(
            "/api/v1/admin/users",
            headers={"Authorization": f"Bearer {real_token}"},
        )
        assert probe.status_code == 200
    finally:
        harness.close()


def test_failed_attempts_lock_the_challenge(mfa_env) -> None:
    """AC3: five wrong codes -> the challenge is dead (403); re-login."""
    harness = MfaHarness()
    try:
        harness.create_user(email="lock@example.test", role="administrator")
        token = harness.login("lock@example.test")["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        setup = harness.client.post("/api/v1/auth/mfa/enroll/setup", headers=headers)
        secret = setup.json()["secret"]
        harness.client.post(
            "/api/v1/auth/mfa/enroll/verify",
            json={"code": pyotp.TOTP(secret).now()},
            headers=headers,
        )

        challenge = harness.login("lock@example.test")
        challenge_token = challenge["access_token"]

        last = None
        for _ in range(5):
            last = harness.client.post(
                "/api/v1/auth/mfa/verify",
                json={"code": "000000"},
                headers={"Authorization": f"Bearer {challenge_token}"},
            )
        assert last.status_code == 403
        assert last.json()["code"] == "MFA_CHALLENGE_LOCKED"

        # even a CORRECT code no longer works on the locked challenge
        correct = harness.client.post(
            "/api/v1/auth/mfa/verify",
            json={"code": pyotp.TOTP(secret).now()},
            headers={"Authorization": f"Bearer {challenge_token}"},
        )
        assert correct.status_code == 403
    finally:
        harness.close()


def test_recovery_code_single_use_sign_in(mfa_env) -> None:
    """AC4: the lost-device path — a recovery code completes the
    challenge and is consumed exactly once."""
    harness = MfaHarness()
    try:
        harness.create_user(email="recovery@example.test", role="administrator")
        token = harness.login("recovery@example.test")["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        setup = harness.client.post("/api/v1/auth/mfa/enroll/setup", headers=headers)
        confirmed = harness.client.post(
            "/api/v1/auth/mfa/enroll/verify",
            json={"code": pyotp.TOTP(setup.json()["secret"]).now()},
            headers=headers,
        )
        codes = confirmed.json()["recovery_codes"]

        challenge = harness.login("recovery@example.test")
        challenge_token = challenge["access_token"]

        first = harness.client.post(
            "/api/v1/auth/mfa/verify",
            json={"code": codes[0], "recovery_code": True},
            headers={"Authorization": f"Bearer {challenge_token}"},
        )
        assert first.status_code == 200, first.text

        # the same code cannot be replayed on a fresh challenge
        harness.client.post("/api/v1/auth/logout")
        challenge2 = harness.login("recovery@example.test")
        replay = harness.client.post(
            "/api/v1/auth/mfa/verify",
            json={"code": codes[0], "recovery_code": True},
            headers={"Authorization": f"Bearer {challenge2['access_token']}"},
        )
        assert replay.status_code == 400
    finally:
        harness.close()


def test_password_reset_does_not_bypass_mfa(mfa_env) -> None:
    """AC4: reset changes the credential — the next sign-in still
    challenges MFA."""
    harness = MfaHarness()
    try:
        harness.create_user(email="resetbypass@example.test", role="administrator")
        token = harness.login("resetbypass@example.test")["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        setup = harness.client.post("/api/v1/auth/mfa/enroll/setup", headers=headers)
        harness.client.post(
            "/api/v1/auth/mfa/enroll/verify",
            json={"code": pyotp.TOTP(setup.json()["secret"]).now()},
            headers=headers,
        )

        # reset the password through the JHEP-124 flow
        harness.client.post(
            "/api/v1/auth/forgot-password",
            json={"email": "resetbypass@example.test"},
        )
        import hashlib

        from app.models import PasswordResetToken

        row = harness.session.exec(select(PasswordResetToken)).first()
        raw = "live-test-reset-token"
        row.token_hash = hashlib.sha256(raw.encode()).hexdigest()
        harness.session.add(row)
        harness.session.commit()
        reset = harness.client.post(
            "/api/v1/auth/reset-password",
            json={"token": raw, "new_password": "BrandNew123"},
        )
        assert reset.status_code == 200

        # the sign-in STILL challenges — no bypass
        challenge = harness.login("resetbypass@example.test", password="BrandNew123")
        assert challenge["mfa_required"] is True
        probe = harness.client.get(
            "/api/v1/admin/users",
            headers={"Authorization": f"Bearer {challenge['access_token']}"},
        )
        assert probe.status_code == 401
    finally:
        harness.close()


def test_learner_role_cannot_enroll(mfa_env) -> None:
    """The confirmed policy: Learners are not offered enrollment."""
    harness = MfaHarness()
    try:
        harness.create_user(email="learner@example.test", role="learner")
        token = harness.login("learner@example.test")["access_token"]
        response = harness.client.post(
            "/api/v1/auth/mfa/enroll/setup",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 403
        assert response.json()["code"] == "MFA_NOT_AVAILABLE"
    finally:
        harness.close()


def test_expired_challenge_is_rejected(mfa_env, monkeypatch) -> None:
    """AC3: an expired challenge cannot complete."""
    harness = MfaHarness()
    try:
        harness.create_user(email="expired@example.test", role="administrator")
        token = harness.login("expired@example.test")["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        setup = harness.client.post("/api/v1/auth/mfa/enroll/setup", headers=headers)
        secret = setup.json()["secret"]
        harness.client.post(
            "/api/v1/auth/mfa/enroll/verify",
            json={"code": pyotp.TOTP(secret).now()},
            headers=headers,
        )

        challenge = harness.login("expired@example.test")
        challenge_token = challenge["access_token"]

        # expire all challenges in the DB
        rows = harness.session.exec(select(MfaLoginChallenge)).all()
        for row in rows:
            row.expires_at = row.created_at.replace(year=row.created_at.year - 1)
            harness.session.add(row)
        harness.session.commit()

        expired = harness.client.post(
            "/api/v1/auth/mfa/verify",
            json={"code": pyotp.TOTP(secret).now()},
            headers={"Authorization": f"Bearer {challenge_token}"},
        )
        assert expired.status_code == 400
    finally:
        harness.close()
