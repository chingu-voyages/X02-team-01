"""JHEP-124 — Recover Access with a Secure Password Reset.

AC1 generic confirmation (no enumeration) · AC2 single-use, expiring
challenges · AC3 the registration password policy · AC4 rate limiting
and no token/account leakage · AC5 sessions revoked via the iat check
while role/ownership stay untouched.
"""

import re
from collections.abc import Iterator
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.core.security import create_access_token_for_learner
from app.db.session import get_session
from app.main import app
from app.models import (
    EmailVerificationToken,
    PasswordResetToken,
    User,
)
from app.services import password_reset_service as reset_module
from app.services.password_reset_service import GENERIC_RESET_MESSAGE


class CapturingSender:
    def __init__(self) -> None:
        self.bodies: list[tuple[str, str, str]] = []

    def send(self, *, to: str, subject: str, body: str) -> None:
        self.bodies.append((to, subject, body))


def _create_user(
    session: Session,
    *,
    email: str,
    password: str = "Str0ngEn0ugh1",
    role: str = "learner",
    is_verified: bool = True,
) -> User:
    user = User(
        email=email,
        full_name="Reset Tester",
        hashed_password=(None),  # set through the service path or directly below
        role=role,
        is_verified=is_verified,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


class ResetHarness:
    """SQLite-backed app with the reset service wired to a real session."""

    def __init__(self) -> None:
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
            ],
        )

        self.session = Session(self.engine)
        self.sender = CapturingSender()
        # the service calls the factory; replace it with one returning
        # our capturing sender
        reset_module.email_sender = lambda: self.sender

        def override_session() -> Iterator[Session]:
            yield self.session

        app.dependency_overrides[get_session] = override_session
        self.client = TestClient(app)

    def close(self) -> None:
        app.dependency_overrides.pop(get_session, None)
        self.client.close()
        self.session.close()
        self.engine.dispose()

    def request(self, email: str) -> object:
        return self.client.post("/api/v1/auth/forgot-password", json={"email": email})

    def reset(self, token: str, new_password: str) -> object:
        return self.client.post(
            "/api/v1/auth/reset-password",
            json={"token": token, "new_password": new_password},
        )

    def last_token(self) -> str:
        """Parse the raw one-time token out of the captured email body —
        the same trick the verification tests use."""
        body = self.sender.bodies[-1][2]
        return re.search(r"token=([A-Za-z0-9_\-]+)", body).group(1)


def test_forgot_password_is_generic_regardless_of_account_existence() -> None:
    """AC1: existing, unknown, and differently-cased emails get the
    byte-identical response."""
    harness = ResetHarness()
    try:
        _create_user(harness.session, email="known@example.com", role="learner")

        known = harness.request("known@example.com")
        unknown = harness.request("ghost@example.com")
        assert known.status_code == unknown.status_code == 200
        assert known.json() == unknown.json()
        assert known.json()["message"] == GENERIC_RESET_MESSAGE

        # only the known account produced a challenge + email
        tokens = harness.session.exec(select(PasswordResetToken)).all()
        assert len(tokens) == 1
        assert len(harness.sender.bodies) == 1
        assert harness.sender.bodies[0][0] == "known@example.com"
    finally:
        harness.close()


def test_reset_requests_are_rate_limited_per_account() -> None:
    """AC4: the second request inside the window is a coded 429."""
    harness = ResetHarness()
    try:
        _create_user(harness.session, email="throttle@example.com")

        first = harness.request("throttle@example.com")
        assert first.status_code == 200

        second = harness.request("throttle@example.com")
        assert second.status_code == 429
        assert second.json()["code"] == "RATE_LIMITED"

        # unknown accounts are never throttled (they produce nothing)
        ghost = harness.request("ghost@example.com")
        assert ghost.status_code == 200
    finally:
        harness.close()


def test_a_new_request_invalidates_prior_unused_challenges() -> None:
    harness = ResetHarness()
    try:
        import time

        _create_user(harness.session, email="reissue@example.com")
        harness.request("reissue@example.com")
        first_token = harness.last_token()

        time.sleep(1.1)  # outpace the 60s limiter via the service constant
        reset_module.RESET_MIN_INTERVAL_SECONDS = 0
        try:
            second = harness.request("reissue@example.com")
        finally:
            reset_module.RESET_MIN_INTERVAL_SECONDS = (
                reset_module.RESET_MIN_INTERVAL_SECONDS + 60
            )
        assert second.status_code == 200

        stale = harness.session.exec(
            select(PasswordResetToken).where(
                PasswordResetToken.token_hash == reset_module._token_hash(first_token)
            )
        ).one()
        assert stale.used_at is not None  # invalidated

        # the stale challenge can no longer reset
        response = harness.reset(first_token, "NewPass123")
        assert response.status_code == 400
        assert response.json()["code"] == "INVALID_OR_EXPIRED_RESET_TOKEN"
    finally:
        harness.close()


def test_successful_reset_sets_the_new_credential() -> None:
    """AC2/AC3: valid challenge + policy-passing password -> sign-in
    works with the new password and fails with the old one."""
    harness = ResetHarness()
    try:
        _create_user(harness.session, email="resetme@example.com")
        harness.request("resetme@example.com")
        token = harness.last_token()

        response = harness.reset(token, "BrandNew123")
        assert response.status_code == 200
        assert "Sign in" in response.json()["message"]

        old_login = harness.client.post(
            "/api/v1/auth/login",
            json={"email": "resetme@example.com", "password": "Str0ngEn0ugh1"},
        )
        assert old_login.status_code == 401

        new_login = harness.client.post(
            "/api/v1/auth/login",
            json={"email": "resetme@example.com", "password": "BrandNew123"},
        )
        assert new_login.status_code == 200
    finally:
        harness.close()


def test_weak_passwords_are_rejected_by_the_policy() -> None:
    """AC3: the same policy as registration, with its messages."""
    harness = ResetHarness()
    try:
        _create_user(harness.session, email="policy@example.com")
        harness.request("policy@example.com")
        token = harness.last_token()

        response = harness.reset(token, "weak")
        assert response.status_code == 422
        assert response.json()["code"] == "WEAK_PASSWORD"
        assert "at least 8 characters" in response.json()["message"]

        stored = harness.session.exec(
            select(User).where(User.email == "policy@example.com")
        ).one()
        assert stored.hashed_password is None  # nothing mutated
    finally:
        harness.close()


def test_unknown_used_and_expired_challenges_cannot_reset() -> None:
    """AC2: the full failure matrix — and nothing mutates."""
    harness = ResetHarness()
    try:
        user = _create_user(harness.session, email="matrix@example.com")
        harness.request("matrix@example.com")
        token = harness.last_token()

        unknown = harness.reset(uuid4().hex + "x", "BrandNew123")
        assert unknown.status_code == 400
        assert unknown.json()["code"] == "INVALID_OR_EXPIRED_RESET_TOKEN"

        # expire the live challenge, then try it
        row = harness.session.exec(
            select(PasswordResetToken).where(
                PasswordResetToken.token_hash == reset_module._token_hash(token)
            )
        ).one()
        row.expires_at = row.expires_at.replace(year=row.expires_at.year - 1)
        harness.session.add(row)
        harness.session.commit()

        expired = harness.reset(token, "BrandNew123")
        assert expired.status_code == 400

        # use the (now expired-but-marked) flow: a fresh valid one gets
        # consumed exactly once
        reset_module.RESET_MIN_INTERVAL_SECONDS = 0
        harness.request("matrix@example.com")
        fresh = harness.last_token()
        first_use = harness.reset(fresh, "BrandNew123")
        assert first_use.status_code == 200
        replay = harness.reset(fresh, "OtherPass456")
        assert replay.status_code == 400

        stored = harness.session.exec(select(User).where(User.id == user.id)).one()
        assert stored.role == "learner"  # AC5: role untouched
    finally:
        harness.close()


def test_reset_invalidates_pre_reset_sessions() -> None:
    """AC5 kill-shot: an access token minted BEFORE the reset is
    rejected afterwards — stateless revocation via the iat check."""
    harness = ResetHarness()
    try:
        user = _create_user(harness.session, email="sessions@example.com")
        pre_reset_token = create_access_token_for_learner(user)

        harness.request("sessions@example.com")
        token = harness.last_token()

        before = harness.client.get(
            "/api/v1/admin/users",  # any get_current_user-protected route
            headers={"Authorization": f"Bearer {pre_reset_token}"},
        )
        assert before.status_code in (200, 403)  # authenticated, role-gated

        response = harness.reset(token, "BrandNew123")
        assert response.status_code == 200

        after = harness.client.get(
            "/api/v1/admin/users",
            headers={"Authorization": f"Bearer {pre_reset_token}"},
        )
        assert after.status_code == 401

        stored = harness.session.exec(select(User).where(User.id == user.id)).one()
        assert stored.sessions_invalid_before is not None
    finally:
        harness.close()


def test_reset_tokens_never_leak_into_logs_or_responses() -> None:
    """AC4: the challenge exists only as a digest server-side and the
    raw value appears only in the emailed link."""
    harness = ResetHarness()
    try:
        _create_user(harness.session, email="leakcheck@example.com")
        harness.request("leakcheck@example.com")
        raw = harness.last_token()

        row = harness.session.exec(
            select(PasswordResetToken).where(
                PasswordResetToken.user_id.is_not(None)  # type: ignore[attr-defined]
            )
        ).first()
        assert raw not in row.token_hash  # only the digest is stored

        response = harness.request("leakcheck@example.com")
        assert raw not in response.text  # the response carries nothing
        assert "token" not in response.json()
    finally:
        harness.close()
