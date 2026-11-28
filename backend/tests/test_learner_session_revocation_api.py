"""JHEP-207: the real learner HTTP routes must honor revoked sessions.

No authentication dependency is overridden. Existing SQLite harnesses provide
real users, credentials, MFA challenges and (for promotion) the audit table.
The positive catalog probe uses a content repository double, not an auth double.
"""

import hashlib
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from test_admin_promotion_api import (
    confirmation,
    path,
    promotion_harness,  # noqa: F401
)
from test_mfa_hardening_api import (
    AUTH,
    NEW_PASSWORD,
    Harness,
    bearer,
    harness,  # noqa: F401
)

from app.api.v1.endpoints.learner_practice_exams import (
    get_practice_exam_catalog_repository,
)
from app.core.security import create_access_token, create_access_token_for_learner
from app.main import app
from app.models import PasswordResetToken

API = "/api/v1"
CATALOG = f"{API}/exams/catalog"


def assert_learner_routes_blocked(client, token: str, expected: int = 401) -> None:
    """All eleven content handlers must reject before reading/writing content."""
    attempt = uuid4()
    question = uuid4()
    root = f"{API}/exams/{attempt}"
    response = {"selected_option_ids": [str(uuid4())]}
    requests = [
        ("GET", f"{API}/categories", None),
        ("GET", f"{API}/questions", None),
        ("GET", CATALOG, None),
        (
            "POST",
            f"{API}/exams",
            {"certification_id": str(uuid4()), "question_count": 1},
        ),
        ("GET", root, None),
        ("PUT", f"{root}/questions/{question}/flag", {"flagged_for_review": True}),
        ("PATCH", f"{root}/progress", {"current_position": 1}),
        ("PUT", f"{root}/responses/{question}", response),
        ("POST", f"{root}/responses/{question}/submit", response),
        ("POST", f"{root}/submit", None),
        ("GET", f"{root}/results", None),
    ]
    for method, url, payload in requests:
        options = {"json": payload} if payload is not None else {}
        result = client.request(method, url, headers=bearer(token), **options)
        assert result.status_code == expected, (method, url, result.text)
        if expected == 401:
            assert result.headers["www-authenticate"] == "Bearer"


def assert_catalog_allowed(client, token: str, monkeypatch: pytest.MonkeyPatch) -> None:
    # The authentication/MFA tables are real; this harness intentionally does
    # not build the question bank. Substitute only the read-only content repo.
    with monkeypatch.context() as patch:
        patch.setitem(
            app.dependency_overrides,
            get_practice_exam_catalog_repository,
            lambda: SimpleNamespace(list_available=lambda: []),
        )
        result = client.get(CATALOG, headers=bearer(token))
    assert result.status_code == 200, result.text
    assert result.json() == {"exams": []}


def test_password_reset_revokes_every_learner_content_route(harness, monkeypatch):  # noqa: F811
    user = harness.create_user("learner")
    previous = harness.login(user)["access_token"]
    assert_catalog_allowed(harness.client, previous, monkeypatch)
    raw = "local-session-revocation-test-token"
    harness.session.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=hashlib.sha256(raw.encode()).hexdigest(),
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        )
    )
    harness.session.commit()
    result = harness.client.post(
        f"{AUTH}/reset-password", json={"token": raw, "new_password": NEW_PASSWORD}
    )
    assert result.status_code == 200, result.text
    assert_learner_routes_blocked(harness.client, previous)
    fresh = harness.login(user, NEW_PASSWORD)["access_token"]
    assert_catalog_allowed(harness.client, fresh, monkeypatch)


@pytest.mark.parametrize("role", ["administrator", "contributor"])
def test_mfa_enrollment_and_pending_challenges_cannot_access_content(  # noqa: F811
    harness,  # noqa: F811
    monkeypatch,
    role,
):
    user = harness.create_user(role)
    previous, secret, _ = harness.enroll(user)
    assert_learner_routes_blocked(harness.client, previous)
    pending = harness.challenge(user)["access_token"]
    assert_learner_routes_blocked(harness.client, pending)
    # A signed password-only token issued after enrollment still has no MFA
    # proof and must not obtain access merely by having a recent issue time.
    assert_learner_routes_blocked(harness.client, create_access_token_for_learner(user))
    fresh = harness.signed_in(user, secret)
    assert_catalog_allowed(harness.client, fresh, monkeypatch)


def test_unenrolled_admin_scopes_and_legacy_tokens_fail_closed(harness):  # noqa: F811
    user = harness.create_user("administrator")
    restricted = harness.login(user)["access_token"]
    assert_learner_routes_blocked(harness.client, restricted)
    assert_learner_routes_blocked(
        harness.client, create_access_token_for_learner(user), expected=403
    )


@pytest.mark.parametrize("subject", ["legacy-user-name", str(uuid4())])
def test_signed_subject_without_account_is_rejected(harness, subject):  # noqa: F811
    assert_learner_routes_blocked(harness.client, create_access_token(subject))


def test_deleted_account_can_no_longer_use_existing_token(harness, monkeypatch):  # noqa: F811
    user = harness.create_user("learner")
    token = harness.login(user)["access_token"]
    assert_catalog_allowed(harness.client, token, monkeypatch)
    harness.session.delete(user)
    harness.session.commit()
    assert_learner_routes_blocked(harness.client, token)


def test_promotion_revokes_learner_routes_as_well_as_admin_routes(  # noqa: F811
    promotion_harness: Harness,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
):
    h = promotion_harness
    admin = h.create_user("administrator")
    _, admin_secret, _ = h.enroll(admin)
    actor_token = h.signed_in(admin, admin_secret)
    target = h.create_user("contributor")
    _, secret, _ = h.enroll(target)
    previous = h.signed_in(target, secret)
    assert_catalog_allowed(h.client, previous, monkeypatch)
    promoted = h.client.post(
        path(target.id), headers=bearer(actor_token), json=confirmation(target)
    )
    assert promoted.status_code == 200, promoted.text
    assert_learner_routes_blocked(h.client, previous)
    assert (
        h.client.get(f"{API}/admin/users", headers=bearer(previous)).status_code == 401
    )
    fresh = h.signed_in(target, secret)
    assert_catalog_allowed(h.client, fresh, monkeypatch)
    assert h.client.get(f"{API}/admin/users", headers=bearer(fresh)).status_code == 200
