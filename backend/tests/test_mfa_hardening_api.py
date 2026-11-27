"""JHEP-207: regression coverage for MFA/session hardening before promotion."""

import hashlib
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pyotp
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.core.security import create_access_token_for_learner, hash_password
from app.db.session import get_session
from app.main import app
from app.models import (
    EmailVerificationToken,
    MfaLoginChallenge,
    MfaRecoveryCode,
    PasswordResetToken,
    User,
)
from app.services import mfa_service

AUTH = "/api/v1/auth"
PASSWORD = "Str0ngEn0ugh1"
NEW_PASSWORD = "NewStr0ngPass2"


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class Harness:
    def __init__(self, client: TestClient, session: Session):
        self.client = client
        self.session = session

    def create_user(self, role: str) -> User:
        user = User(
            email=f"{role}@example.test",
            full_name=role.title(),
            role=role,
            hashed_password=hash_password(PASSWORD),
            is_verified=True,
        )
        self.session.add(user)
        self.session.commit()
        self.session.refresh(user)
        return user

    def login(self, user: User, password: str = PASSWORD) -> dict:
        response = self.client.post(
            f"{AUTH}/login", json={"email": user.email, "password": password}
        )
        assert response.status_code == 200, response.text
        return response.json()

    def enroll(self, user: User) -> tuple[str, str, list[str]]:
        login = self.login(user)
        assert login["mfa_required"] is False
        token = login["access_token"]
        setup = self.client.post(f"{AUTH}/mfa/enroll/setup", headers=bearer(token))
        assert setup.status_code == 200, setup.text
        secret = setup.json()["secret"]
        confirm = self.client.post(
            f"{AUTH}/mfa/enroll/verify",
            json={"code": pyotp.TOTP(secret).now()},
            headers=bearer(token),
        )
        assert confirm.status_code == 200, confirm.text
        self.session.refresh(user)
        return token, secret, confirm.json()["recovery_codes"]

    def challenge(self, user: User, password: str = PASSWORD) -> dict:
        result = self.login(user, password)
        assert result["mfa_required"] is True
        assert result["challenge_id"] is not None
        return result

    def complete(self, challenge: dict, code: str, recovery: bool = False):
        return self.client.post(
            f"{AUTH}/mfa/verify",
            json={"code": code, "recovery_code": recovery},
            headers=bearer(challenge["access_token"]),
        )

    def signed_in(self, user: User, secret: str) -> str:
        response = self.complete(self.challenge(user), pyotp.TOTP(secret).now())
        assert response.status_code == 200, response.text
        return response.json()["access_token"]

    def status(self, token: str):
        return self.client.get(f"{AUTH}/mfa/status", headers=bearer(token))


@pytest.fixture
def harness(monkeypatch: pytest.MonkeyPatch) -> Iterator[Harness]:
    monkeypatch.setattr(mfa_service.settings, "mfa_encryption_key", "local-test-key")
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(
        engine,
        tables=[
            User.__table__,
            EmailVerificationToken.__table__,
            PasswordResetToken.__table__,
            MfaLoginChallenge.__table__,
            MfaRecoveryCode.__table__,
        ],
    )

    def override_session() -> Iterator[Session]:
        # A fresh transaction per HTTP request, like the real dependency.
        with Session(engine) as session:
            yield session

    previous = app.dependency_overrides.copy()
    app.dependency_overrides[get_session] = override_session
    try:
        with Session(engine) as session:
            # Keep lifespan behavior identical to the existing MFA harness.
            client = TestClient(app)
            try:
                yield Harness(client, session)
            finally:
                client.close()
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)
        engine.dispose()


@pytest.mark.parametrize("role", ["administrator", "contributor"])
def test_enrollment_revokes_pre_enrollment_sessions_and_requires_mfa(harness, role):
    user = harness.create_user(role)
    previous_token, secret, _ = harness.enroll(user)
    assert harness.status(previous_token).status_code == 401
    assert user.sessions_invalid_before is not None
    challenge = harness.challenge(user)
    assert harness.status(challenge["access_token"]).status_code == 401
    completed = harness.complete(challenge, pyotp.TOTP(secret).now())
    assert completed.status_code == 200, completed.text
    assert harness.status(completed.json()["access_token"]).status_code == 200


def test_confirmed_enrollment_cannot_be_replaced(harness):
    user = harness.create_user("administrator")
    _, secret, _ = harness.enroll(user)
    original_secret = user.totp_secret_encrypted
    token = harness.signed_in(user, secret)
    response = harness.client.post(f"{AUTH}/mfa/enroll/setup", headers=bearer(token))
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "MFA_ALREADY_ENROLLED"
    assert "secret" not in response.json()
    harness.session.refresh(user)
    assert user.totp_secret_encrypted == original_secret
    assert harness.status(harness.signed_in(user, secret)).status_code == 200


def test_pending_challenge_is_rejected_by_legacy_subject_guard(harness):
    user = harness.create_user("administrator")
    _, _, _ = harness.enroll(user)
    challenge = harness.challenge(user)
    # Logout is an existing endpoint using get_current_subject rather than
    # the database-backed get_current_user dependency.
    response = harness.client.post(
        f"{AUTH}/logout", headers=bearer(challenge["access_token"])
    )
    assert response.status_code == 401, response.text


def test_password_only_token_without_mfa_proof_is_rejected(harness):
    user = harness.create_user("administrator")
    _, _, _ = harness.enroll(user)
    # Model an old-format access token issued after the revocation cutoff.
    token = create_access_token_for_learner(user)
    assert harness.status(token).status_code == 401


def test_confirmed_mfa_survives_role_downgrade(harness):
    user = harness.create_user("contributor")
    _, secret, _ = harness.enroll(user)
    user.role = "learner"
    harness.session.add(user)
    harness.session.commit()
    assert harness.status(harness.signed_in(user, secret)).status_code == 200


def test_enrollment_permission_is_rechecked_on_confirmation(harness):
    user = harness.create_user("contributor")
    token = harness.login(user)["access_token"]
    setup = harness.client.post(f"{AUTH}/mfa/enroll/setup", headers=bearer(token))
    assert setup.status_code == 200, setup.text
    user.role = "learner"
    harness.session.add(user)
    harness.session.commit()
    response = harness.client.post(
        f"{AUTH}/mfa/enroll/verify",
        json={"code": pyotp.TOTP(setup.json()["secret"]).now()},
        headers=bearer(token),
    )
    assert response.status_code == 403, response.text
    harness.session.refresh(user)
    assert user.mfa_enrolled_at is None


@pytest.mark.parametrize("recovery", [False, True])
def test_password_reset_invalidates_outstanding_mfa_challenges(harness, recovery):
    user = harness.create_user("administrator")
    _, secret, recovery_codes = harness.enroll(user)
    challenge = harness.challenge(user)
    raw_token = "local-test-reset-token-0123456789abcdef"
    harness.session.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=hashlib.sha256(raw_token.encode()).hexdigest(),
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        )
    )
    harness.session.commit()
    reset = harness.client.post(
        f"{AUTH}/reset-password",
        json={"token": raw_token, "new_password": NEW_PASSWORD},
    )
    assert reset.status_code == 200, reset.text
    code = recovery_codes[0] if recovery else pyotp.TOTP(secret).now()
    stale = harness.complete(challenge, code, recovery=recovery)
    assert stale.status_code == 400, stale.text
    assert stale.json()["code"] == "INVALID_MFA_CODE"
    # Fresh authentication must still require MFA. A rejected stale
    # recovery attempt must not consume the one-time recovery code.
    fresh = harness.challenge(user, NEW_PASSWORD)
    code = recovery_codes[0] if recovery else pyotp.TOTP(secret).now()
    completed = harness.complete(fresh, code, recovery=recovery)
    assert completed.status_code == 200, completed.text
    assert harness.status(completed.json()["access_token"]).status_code == 200


@pytest.mark.parametrize("recovery", [False, True])
def test_consumed_mfa_challenge_cannot_be_replayed(harness, recovery):
    user = harness.create_user("administrator")
    _, secret, recovery_codes = harness.enroll(user)
    challenge = harness.challenge(user)
    code = recovery_codes[0] if recovery else pyotp.TOTP(secret).now()
    first = harness.complete(challenge, code, recovery=recovery)
    assert first.status_code == 200, first.text
    replay = harness.complete(challenge, code, recovery=recovery)
    assert replay.status_code == 400, replay.text
    assert replay.json()["code"] == "INVALID_MFA_CODE"
    if recovery:
        codes = harness.session.exec(select(MfaRecoveryCode)).all()
        assert sum(row.used_at is not None for row in codes) == 1
