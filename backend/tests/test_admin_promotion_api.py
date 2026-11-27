"""Real authentication and API checks for the separate administrator grant.

This module is intentionally NOT in the legacy unenrolled-admin fixture list.
SQLite checks transaction behavior; row-lock contention must also be tested on
local PostgreSQL before deployment.
"""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pyotp
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select
from test_mfa_hardening_api import Harness, bearer

from app.core.security import create_access_token_for_learner
from app.db.session import get_session
from app.main import app
from app.models import (
    MfaLoginChallenge,
    MfaRecoveryCode,
    RoleChangeAudit,
    User,
)
from app.services import mfa_service

ADMIN = "/api/v1/admin/users"


@pytest.fixture
def promotion_harness(monkeypatch: pytest.MonkeyPatch) -> Iterator[Harness]:
    monkeypatch.setattr(
        mfa_service.settings, "mfa_encryption_key", "promotion-test-key"
    )
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(
        engine,
        tables=[
            User.__table__,
            MfaLoginChallenge.__table__,
            MfaRecoveryCode.__table__,
            RoleChangeAudit.__table__,
        ],
    )

    def override_session() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    previous = app.dependency_overrides.copy()
    app.dependency_overrides[get_session] = override_session
    try:
        with Session(engine) as session:
            client = TestClient(app)
            try:
                yield Harness(client, session)
            finally:
                client.close()
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)
        engine.dispose()


@pytest.fixture
def actor(promotion_harness: Harness) -> tuple[User, str]:
    user = promotion_harness.create_user("administrator")
    _, secret, _ = promotion_harness.enroll(user)
    return user, promotion_harness.signed_in(user, secret)


@pytest.fixture
def eligible_target(promotion_harness: Harness) -> tuple[User, str]:
    user = promotion_harness.create_user("contributor")
    _, secret, _ = promotion_harness.enroll(user)
    return user, secret


def path(target_id) -> str:
    return f"{ADMIN}/{target_id}/administrator-promotion"


def confirmation(target: User, **changes) -> dict:
    return {
        "confirmation_email": target.email,
        "confirm": True,
        "reason": "Approved administrator onboarding",
        **changes,
    }


def assert_unchanged(
    harness: Harness, target: User, *, role: str = "contributor"
) -> None:
    harness.session.refresh(target)
    assert target.role == role
    assert harness.session.exec(select(RoleChangeAudit)).all() == []


def test_preview_is_read_only_and_does_not_expose_credentials(
    promotion_harness, actor, eligible_target
):
    _, token = actor
    target, secret = eligible_target
    response = promotion_harness.client.get(path(target.id), headers=bearer(token))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["eligible"] is True
    assert body["recent_authentication"] is True
    assert body["authentication_max_age_seconds"] == 300
    assert body["mfa_enrolled"] is True
    assert body["issues"] == []
    assert body["target"]["role"] == "contributor"
    assert secret not in response.text
    assert "hashed_password" not in body["target"]
    assert "totp_secret_encrypted" not in body["target"]
    assert_unchanged(promotion_harness, target)


def test_promotion_is_atomic_and_requires_new_mfa_sign_in(
    promotion_harness, actor, eligible_target
):
    administrator, token = actor
    target, secret = eligible_target
    old_session = promotion_harness.signed_in(target, secret)
    old_challenge = promotion_harness.challenge(target)
    prior_password = target.hashed_password
    prior_mfa = target.totp_secret_encrypted
    prior_name = target.full_name
    response = promotion_harness.client.post(
        path(target.id), headers=bearer(token), json=confirmation(target)
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["user"]["role"] == "administrator"
    assert body["previous_privileged_sessions_revoked"] is True
    promotion_harness.session.refresh(target)
    assert target.role == "administrator"
    assert target.hashed_password == prior_password
    assert target.totp_secret_encrypted == prior_mfa
    assert target.full_name == prior_name
    assert target.sessions_invalid_before is not None
    audits = promotion_harness.session.exec(select(RoleChangeAudit)).all()
    assert len(audits) == 1
    audit = audits[0]
    assert str(audit.id) == body["audit_id"]
    assert audit.actor_id == administrator.id
    assert audit.target_id == target.id
    assert audit.role_before == "contributor"
    assert audit.role_after == "administrator"
    assert audit.action == "promoted"
    assert audit.note == "Approved administrator onboarding"
    assert (
        promotion_harness.client.get(ADMIN, headers=bearer(old_session)).status_code
        == 401
    )
    assert (
        promotion_harness.complete(old_challenge, pyotp.TOTP(secret).now()).status_code
        == 400
    )
    fresh = promotion_harness.signed_in(target, secret)
    assert promotion_harness.client.get(ADMIN, headers=bearer(fresh)).status_code == 200
    repeat = promotion_harness.client.post(
        path(target.id), headers=bearer(token), json=confirmation(target)
    )
    assert repeat.status_code == 409
    assert len(promotion_harness.session.exec(select(RoleChangeAudit)).all()) == 1


@pytest.mark.parametrize("method", ["GET", "POST"])
@pytest.mark.parametrize("role", [None, "learner", "contributor", "enrollment"])
def test_promotion_endpoints_reject_unauthorized_sessions(
    promotion_harness, method, role
):
    # Do not seed an enrolled administrator for the negative cases.
    target = User(email="target@example.test", full_name="Target", role="contributor")
    promotion_harness.session.add(target)
    promotion_harness.session.commit()
    headers = {}
    if role is not None:
        user = promotion_harness.create_user(
            "administrator" if role == "enrollment" else role
        )
        headers = bearer(promotion_harness.login(user)["access_token"])
    kwargs = {"json": confirmation(target)} if method == "POST" else {}
    response = promotion_harness.client.request(
        method, path(target.id), headers=headers, **kwargs
    )
    assert response.status_code == (401 if role is None else 403), response.text
    assert_unchanged(promotion_harness, target)


def test_pending_mfa_challenge_cannot_grant_access(
    promotion_harness, actor, eligible_target
):
    administrator, _ = actor
    target, _ = eligible_target
    challenge = promotion_harness.challenge(administrator)
    response = promotion_harness.client.post(
        path(target.id),
        headers=bearer(challenge["access_token"]),
        json=confirmation(target),
    )
    assert response.status_code == 401
    assert_unchanged(promotion_harness, target)


@pytest.mark.parametrize(
    ("field", "value", "code"),
    [
        ("is_verified", False, "ADMIN_PROMOTION_EMAIL_UNVERIFIED"),
        ("hashed_password", None, "ADMIN_PROMOTION_PASSWORD_REQUIRED"),
        ("mfa_enrolled_at", None, "ADMIN_PROMOTION_MFA_REQUIRED"),
        (
            "totp_secret_encrypted",
            "invalid-encrypted-value",
            "ADMIN_PROMOTION_TARGET_MFA_UNAVAILABLE",
        ),
        ("role", "learner", "ADMIN_PROMOTION_CONTRIBUTOR_REQUIRED"),
        ("role", "administrator", "ADMIN_PROMOTION_CONTRIBUTOR_REQUIRED"),
    ],
)
def test_target_eligibility_is_rechecked(
    promotion_harness, actor, eligible_target, field, value, code
):
    _, token = actor
    target, _ = eligible_target
    # Get a valid preview, then change the record before confirmation.
    assert promotion_harness.client.get(path(target.id), headers=bearer(token)).json()[
        "eligible"
    ]
    setattr(target, field, value)
    promotion_harness.session.add(target)
    promotion_harness.session.commit()
    preview = promotion_harness.client.get(path(target.id), headers=bearer(token))
    assert preview.status_code == 200
    assert preview.json()["eligible"] is False
    assert preview.json()["issues"][0]["code"] == code
    response = promotion_harness.client.post(
        path(target.id), headers=bearer(token), json=confirmation(target)
    )
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == code
    assert_unchanged(
        promotion_harness, target, role=value if field == "role" else "contributor"
    )


@pytest.mark.parametrize(
    ("updates", "status"),
    [
        ({"confirm": False}, 422),
        ({"confirm": "true"}, 422),
        ({"confirmation_email": "other@example.test"}, 409),
        ({"reason": " "}, 422),
        ({"reason": "x" * 1001}, 422),
        ({"role": "administrator"}, 422),
    ],
)
def test_confirmation_is_explicit_and_strict(
    promotion_harness, actor, eligible_target, updates, status
):
    _, token = actor
    target, _ = eligible_target
    response = promotion_harness.client.post(
        path(target.id), headers=bearer(token), json=confirmation(target, **updates)
    )
    assert response.status_code == status, response.text
    assert_unchanged(promotion_harness, target)


@pytest.mark.parametrize("verified_age", [360, 10])
def test_recent_password_and_mfa_authentication_are_both_required(
    promotion_harness, actor, eligible_target, verified_age
):
    administrator, _ = actor
    target, _ = eligible_target
    now = datetime.now(UTC)
    # Model a legitimate earlier MFA sign-in, not a revoked pre-enrollment token.
    administrator.mfa_enrolled_at = now - timedelta(hours=1)
    administrator.sessions_invalid_before = now - timedelta(hours=1)
    promotion_harness.session.add(administrator)
    promotion_harness.session.commit()
    stale = create_access_token_for_learner(
        administrator,
        authenticated_at=now - timedelta(seconds=370),
        mfa_verified_at=now - timedelta(seconds=verified_age),
    )
    preview = promotion_harness.client.get(path(target.id), headers=bearer(stale))
    assert preview.status_code == 200, preview.text
    assert preview.json()["eligible"] is True
    assert preview.json()["recent_authentication"] is False
    response = promotion_harness.client.post(
        path(target.id), headers=bearer(stale), json=confirmation(target)
    )
    assert response.status_code == 403, response.text
    assert response.json()["detail"]["code"] == "ADMIN_PROMOTION_REAUTH_REQUIRED"
    assert_unchanged(promotion_harness, target)


def test_missing_mfa_configuration_fails_closed(
    promotion_harness, actor, eligible_target, monkeypatch
):
    _, token = actor
    target, _ = eligible_target
    monkeypatch.setattr(mfa_service.settings, "mfa_encryption_key", None)
    response = promotion_harness.client.post(
        path(target.id), headers=bearer(token), json=confirmation(target)
    )
    assert response.status_code == 503, response.text
    assert_unchanged(promotion_harness, target)


def test_self_and_unknown_target_cannot_be_promoted(promotion_harness, actor):
    administrator, token = actor
    response = promotion_harness.client.post(
        path(administrator.id), headers=bearer(token), json=confirmation(administrator)
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "ADMIN_PROMOTION_SELF"
    missing = promotion_harness.client.post(
        path(uuid4()), headers=bearer(token), json=confirmation(administrator)
    )
    assert missing.status_code == 404
    assert_unchanged(promotion_harness, administrator, role="administrator")


def test_ordinary_role_endpoint_cannot_grant_or_remove_admin(
    promotion_harness, actor, eligible_target
):
    _, token = actor
    target, _ = eligible_target
    route = f"{ADMIN}/{target.id}/role"
    response = promotion_harness.client.patch(
        route, headers=bearer(token), json={"role": "administrator"}
    )
    assert response.status_code == 422
    assert_unchanged(promotion_harness, target)
    assert (
        promotion_harness.client.post(
            path(target.id), headers=bearer(token), json=confirmation(target)
        ).status_code
        == 200
    )
    response = promotion_harness.client.patch(
        route, headers=bearer(token), json={"role": "contributor"}
    )
    assert response.status_code == 409
    promotion_harness.session.refresh(target)
    assert target.role == "administrator"


def test_audit_insert_failure_rolls_back_promotion(
    promotion_harness, actor, eligible_target
):
    _, token = actor
    target, _ = eligible_target
    cutoff = target.sessions_invalid_before

    def reject_audit(_mapper, _connection, _row):
        raise RuntimeError("Simulated audit write failure")

    event.listen(RoleChangeAudit, "before_insert", reject_audit)
    try:
        with pytest.raises(RuntimeError, match="Simulated audit write failure"):
            promotion_harness.client.post(
                path(target.id), headers=bearer(token), json=confirmation(target)
            )
    finally:
        event.remove(RoleChangeAudit, "before_insert", reject_audit)
    assert_unchanged(promotion_harness, target)
    assert target.sessions_invalid_before == cutoff
