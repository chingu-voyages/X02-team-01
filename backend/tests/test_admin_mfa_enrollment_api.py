"""Strict production-policy tests; no legacy administrator-fixture bypass."""

import jwt
import pyotp
import pytest
from test_mfa_hardening_api import AUTH, bearer, harness  # noqa: F401

from app.core.config import settings
from app.core.security import create_access_token, create_access_token_for_learner
from app.services import mfa_service

ADMIN = "/api/v1/admin"


def test_unenrolled_admin_login_is_restricted(harness):  # noqa: F811
    user = harness.create_user("administrator")
    body = harness.login(user)
    assert body["mfa_enrollment_required"] is True
    assert body["mfa_required"] is False
    token = body["access_token"]
    claims = jwt.decode(
        token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm]
    )
    assert claims["mfa"] == "enrollment"
    assert 899 <= claims["exp"] - claims["iat"] <= 900
    assert harness.status(token).status_code == 200
    response = harness.client.get(f"{ADMIN}/users", headers=bearer(token))
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "MFA_ENROLLMENT_REQUIRED"


@pytest.mark.parametrize(
    "path",
    [
        "/users",
        "/questions",
        "/certifications",
        "/categories",
        "/practice-exams",
        "/question-imports",
    ],
)
def test_scope_cannot_access_administrative_resources(harness, path):  # noqa: F811
    user = harness.create_user("administrator")
    token = harness.login(user)["access_token"]
    result = harness.client.get(f"{ADMIN}{path}", headers=bearer(token))
    assert result.status_code == 403, result.text
    assert result.json()["detail"]["code"] == "MFA_ENROLLMENT_REQUIRED"


def test_scope_cannot_change_roles(harness):  # noqa: F811
    admin = harness.create_user("administrator")
    target = harness.create_user("learner")
    token = harness.login(admin)["access_token"]
    result = harness.client.patch(
        f"{ADMIN}/users/{target.id}/role",
        headers=bearer(token),
        json={"role": "contributor"},
    )
    assert result.status_code == 403, result.text
    harness.session.refresh(target)
    assert target.role == "learner"


@pytest.mark.parametrize("path", ["/api/v1/categories", "/api/v1/exams/catalog"])
def test_enrollment_token_is_not_accepted_by_legacy_subject_routes(harness, path):  # noqa: F811
    user = harness.create_user("administrator")
    token = harness.login(user)["access_token"]
    result = harness.client.get(path, headers=bearer(token))
    assert result.status_code == 401, result.text


def test_legacy_full_admin_token_does_not_bypass_enrollment(harness):  # noqa: F811
    user = harness.create_user("administrator")
    for token in (
        create_access_token(str(user.id)),
        create_access_token_for_learner(user),
    ):
        response = harness.client.get(f"{ADMIN}/users", headers=bearer(token))
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "MFA_ENROLLMENT_REQUIRED"
        # A fresh password-authenticated enrollment scope is needed for setup.
        assert harness.status(token).status_code == 403
        assert (
            harness.client.post(
                f"{AUTH}/mfa/enroll/setup", headers=bearer(token)
            ).status_code
            == 403
        )


def test_missing_mfa_configuration_fails_closed(harness, monkeypatch):  # noqa: F811
    monkeypatch.setattr(mfa_service.settings, "mfa_encryption_key", None)
    user = harness.create_user("administrator")
    token = harness.login(user)["access_token"]
    posture = harness.status(token)
    assert posture.status_code == 200
    assert posture.json()["configured"] is False
    assert (
        harness.client.post(
            f"{AUTH}/mfa/enroll/setup", headers=bearer(token)
        ).status_code
        == 503
    )
    assert (
        harness.client.get(f"{ADMIN}/users", headers=bearer(token)).status_code == 403
    )


def test_enrollment_then_fresh_mfa_login_grants_admin_access(harness):  # noqa: F811
    user = harness.create_user("administrator")
    token, secret, recovery = harness.enroll(user)
    assert recovery
    assert harness.status(token).status_code == 401
    assert (
        harness.client.get(f"{ADMIN}/users", headers=bearer(token)).status_code == 401
    )
    challenge = harness.challenge(user)
    assert challenge["mfa_enrollment_required"] is False
    pending = challenge["access_token"]
    assert harness.status(pending).status_code == 401
    assert (
        harness.client.post(
            f"{AUTH}/mfa/enroll/setup", headers=bearer(pending)
        ).status_code
        == 401
    )
    completed = harness.complete(challenge, pyotp.TOTP(secret).now())
    assert completed.status_code == 200, completed.text
    assert completed.json()["mfa_enrollment_required"] is False
    full = completed.json()["access_token"]
    assert harness.client.get(f"{ADMIN}/users", headers=bearer(full)).status_code == 200


def test_enrollment_only_session_cannot_be_reused_after_role_change(harness):  # noqa: F811
    user = harness.create_user("administrator")
    token = harness.login(user)["access_token"]
    user.role = "contributor"
    harness.session.add(user)
    harness.session.commit()
    assert harness.status(token).status_code == 401
    response = harness.client.get(f"{ADMIN}/questions", headers=bearer(token))
    assert response.status_code == 401


@pytest.mark.parametrize("role", ["learner", "contributor"])
def test_unenrolled_non_admin_login_remains_unchanged(harness, role):  # noqa: F811
    user = harness.create_user(role)
    body = harness.login(user)
    assert body["mfa_enrollment_required"] is False
    assert body["mfa_required"] is False
    assert harness.status(body["access_token"]).status_code == 200
