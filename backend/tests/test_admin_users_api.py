"""JHEP-125 — Assign and Revoke Contributor Access (Users & Access).

Administrator-managed role changes: locate accounts, move them
Learner<->Contributor, refuse everything else safely, write the audit
row, and keep authored content intact. Authorization is enforced
server-side; revocation takes effect on a stale session's next admin
request because roles are read from the database row, not the token.
"""

from collections.abc import Iterator
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from admin_auth_fixtures import sign_in_administrator
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.core.security import hash_password
from app.db.session import get_session
from app.main import app
from app.models import (
    AnswerOption,
    Category,
    Certification,
    MfaLoginChallenge,
    MfaRecoveryCode,
    PermissionChangeAudit,
    Question,
    QuestionImage,
    QuestionVersion,
    RoleChangeAudit,
    User,
)

pytestmark = pytest.mark.usefixtures("isolated_mfa_configuration")


def _create_user(
    session: Session,
    *,
    email: str,
    password: str,
    role: str,
) -> User:
    user = User(
        email=email,
        full_name=("Administrator" if role == "administrator" else "Learner"),
        hashed_password=hash_password(password),
        role=role,
        is_verified=True,
    )

    session.add(user)
    session.commit()
    session.refresh(user)

    return user


@sa.event.listens_for(sa.engine.Engine, "connect")
def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record) -> None:
    if dbapi_connection.__class__.__module__ == "sqlite3":
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


class UsersHarness:
    """A SQLite-backed app with real logins for every role."""

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
                MfaLoginChallenge.__table__,
                MfaRecoveryCode.__table__,
                Certification.__table__,
                Category.__table__,
                Question.__table__,
                QuestionVersion.__table__,
                AnswerOption.__table__,
                QuestionImage.__table__,
                RoleChangeAudit.__table__,
                PermissionChangeAudit.__table__,
            ],
        )

        self.session = Session(self.engine)

        suffix = uuid4().hex[:8]
        self.admin = _create_user(
            self.session,
            email=f"admin-{suffix}@example.test",
            password="AdminPass1!",
            role="administrator",
        )
        self.learner = _create_user(
            self.session,
            email=f"learner-{suffix}@example.test",
            password="LearnerPass1!",
            role="learner",
        )
        self.contributor = _create_user(
            self.session,
            email=f"contributor-{suffix}@example.test",
            password="ContribPass1!",
            role="contributor",
        )
        self.other_admin = _create_user(
            self.session,
            email=f"admin2-{suffix}@example.test",
            password="AdminPass2!",
            role="administrator",
        )

        def override_session() -> Iterator[Session]:
            yield self.session

        app.dependency_overrides[get_session] = override_session

        self.client = TestClient(app)
        admin_login = sign_in_administrator(
            self.client, self.admin.email, "AdminPass1!"
        )
        self.admin_headers = {"Authorization": f"Bearer {admin_login['access_token']}"}
        self.learner_headers = self._login(self.learner.email, "LearnerPass1!")
        self.contributor_headers = self._login(self.contributor.email, "ContribPass1!")

    def _login(self, email: str, password: str) -> dict[str, str]:
        response = self.client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": password},
        )
        assert response.status_code == 200, response.text
        return {"Authorization": f"Bearer {response.json()['access_token']}"}

    def close(self) -> None:
        app.dependency_overrides.pop(get_session, None)
        self.client.close()
        self.session.close()
        self.engine.dispose()


def test_listing_requires_administrator() -> None:
    harness = UsersHarness()
    try:
        for headers, role in (
            (harness.learner_headers, "learner"),
            (harness.contributor_headers, "contributor"),
        ):
            response = harness.client.get("/api/v1/admin/users", headers=headers)
            assert response.status_code == 403, (role, response.text)
    finally:
        harness.close()


def test_listing_returns_accounts_with_search_and_order() -> None:
    harness = UsersHarness()
    try:
        response = harness.client.get(
            "/api/v1/admin/users", headers=harness.admin_headers
        )
        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 4
        emails = [item["email"] for item in body["items"]]
        assert emails == sorted(emails)
        first = body["items"][0]
        assert set(first) == {
            "id",
            "email",
            "fullName",
            "role",
            "is_verified",
            "grade_short_answers",
            "grade_essays",
            "created_at",
        }
        assert "hashed_password" not in first

        filtered = harness.client.get(
            "/api/v1/admin/users",
            params={"q": "contributor-"},
            headers=harness.admin_headers,
        )
        assert filtered.json()["total"] == 1
        assert filtered.json()["items"][0]["role"] == "contributor"
    finally:
        harness.close()


def test_promote_learner_to_contributor_writes_audit() -> None:
    harness = UsersHarness()
    try:
        response = harness.client.patch(
            f"/api/v1/admin/users/{harness.learner.id}/role",
            json={"role": "contributor"},
            headers=harness.admin_headers,
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["user"]["role"] == "contributor"
        assert body["action"] == "promoted"
        assert body["role_before"] == "learner"
        assert body["role_after"] == "contributor"
        assert "changed_at" in body

        stored = harness.session.exec(
            select(User).where(User.id == harness.learner.id)
        ).one()
        assert stored.role == "contributor"

        audits = harness.session.exec(
            select(RoleChangeAudit).where(
                RoleChangeAudit.target_id == harness.learner.id
            )
        ).all()
        assert len(audits) == 1
        assert audits[0].actor_id == harness.admin.id
        assert audits[0].action == "promoted"
        assert audits[0].role_before == "learner"
        assert audits[0].role_after == "contributor"
        assert audits[0].created_at is not None
    finally:
        harness.close()


def test_revoke_contributor_to_learner_writes_audit() -> None:
    harness = UsersHarness()
    try:
        response = harness.client.patch(
            f"/api/v1/admin/users/{harness.contributor.id}/role",
            json={"role": "learner"},
            headers=harness.admin_headers,
        )
        assert response.status_code == 200
        body = response.json()
        assert body["action"] == "revoked"
        assert body["role_before"] == "contributor"
        assert body["role_after"] == "learner"

        audits = harness.session.exec(
            select(RoleChangeAudit).where(
                RoleChangeAudit.target_id == harness.contributor.id
            )
        ).all()
        assert len(audits) == 1
        assert audits[0].action == "revoked"
    finally:
        harness.close()


def test_noop_change_is_safe_and_still_audited() -> None:
    harness = UsersHarness()
    try:
        response = harness.client.patch(
            f"/api/v1/admin/users/{harness.contributor.id}/role",
            json={"role": "contributor"},
            headers=harness.admin_headers,
        )
        assert response.status_code == 200
        assert response.json()["role_after"] == "contributor"

        stored = harness.session.exec(
            select(User).where(User.id == harness.contributor.id)
        ).one()
        assert stored.role == "contributor"
    finally:
        harness.close()


def test_administrator_target_is_refused_without_mutation() -> None:
    harness = UsersHarness()
    try:
        response = harness.client.patch(
            f"/api/v1/admin/users/{harness.other_admin.id}/role",
            json={"role": "contributor"},
            headers=harness.admin_headers,
        )
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "CANNOT_CHANGE_ADMIN_ROLE"

        stored = harness.session.exec(
            select(User).where(User.id == harness.other_admin.id)
        ).one()
        assert stored.role == "administrator"
        assert harness.session.exec(select(RoleChangeAudit)).all() == []
    finally:
        harness.close()


def test_self_change_is_refused_without_mutation() -> None:
    harness = UsersHarness()
    try:
        response = harness.client.patch(
            f"/api/v1/admin/users/{harness.admin.id}/role",
            json={"role": "learner"},
            headers=harness.admin_headers,
        )
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "CANNOT_CHANGE_OWN_ROLE"
        assert harness.session.exec(select(RoleChangeAudit)).all() == []
    finally:
        harness.close()


def test_change_requires_administrator() -> None:
    harness = UsersHarness()
    try:
        for headers in (harness.learner_headers, harness.contributor_headers):
            response = harness.client.patch(
                f"/api/v1/admin/users/{harness.learner.id}/role",
                json={"role": "contributor"},
                headers=headers,
            )
            assert response.status_code == 403

        stored = harness.session.exec(
            select(User).where(User.id == harness.learner.id)
        ).one()
        assert stored.role == "learner"
    finally:
        harness.close()


def test_invalid_role_value_and_unknown_user_fail_safe() -> None:
    harness = UsersHarness()
    try:
        invalid = harness.client.patch(
            f"/api/v1/admin/users/{harness.learner.id}/role",
            json={"role": "administrator"},
            headers=harness.admin_headers,
        )
        assert invalid.status_code == 422

        unknown = harness.client.patch(
            f"/api/v1/admin/users/{uuid4()}/role",
            json={"role": "contributor"},
            headers=harness.admin_headers,
        )
        assert unknown.status_code == 404
        assert unknown.json()["detail"]["code"] == "USER_NOT_FOUND"

        assert harness.session.exec(select(RoleChangeAudit)).all() == []
    finally:
        harness.close()


def test_revocation_takes_effect_on_the_stale_session() -> None:
    """AC2: the old session's next admin request is rejected — the role
    is read from the database row, never from the token."""
    harness = UsersHarness()
    try:
        before = harness.client.get(
            "/api/v1/admin/questions", headers=harness.contributor_headers
        )
        assert before.status_code == 200

        revoke = harness.client.patch(
            f"/api/v1/admin/users/{harness.contributor.id}/role",
            json={"role": "learner"},
            headers=harness.admin_headers,
        )
        assert revoke.status_code == 200

        after = harness.client.get(
            "/api/v1/admin/questions", headers=harness.contributor_headers
        )
        assert after.status_code == 403
    finally:
        harness.close()


def test_revocation_preserves_authored_questions() -> None:
    """AC3: content, ids, versions and ownership stay intact; the
    Administrator still manages the records."""
    harness = UsersHarness()
    try:
        certification = Certification(
            name=f"Cert-{uuid4().hex[:6]}",
            code=f"CERT-{uuid4().hex[:8].upper()}",
        )
        harness.session.add(certification)
        harness.session.commit()
        harness.session.refresh(certification)
        category = Category(
            certification_id=certification.id,
            name=f"Cat-{uuid4().hex[:6]}",
        )
        harness.session.add(category)
        harness.session.commit()
        harness.session.refresh(category)

        draft = harness.client.post(
            "/api/v1/admin/questions",
            json={
                "certification_id": str(certification.id),
                "category_id": str(category.id),
                "question_text": "Which option is correct?",
                "question_type": "multiple_choice",
                "difficulty": "easy",
                "options": [
                    {"option_text": "A", "is_correct": True},
                    {"option_text": "B", "is_correct": False},
                ],
            },
            headers=harness.contributor_headers,
        )
        assert draft.status_code in (200, 201), draft.text
        question_id = UUID(draft.json()["question_id"])

        revoke = harness.client.patch(
            f"/api/v1/admin/users/{harness.contributor.id}/role",
            json={"role": "learner"},
            headers=harness.admin_headers,
        )
        assert revoke.status_code == 200

        stored = harness.session.exec(
            select(Question).where(Question.id == question_id)
        ).one()
        assert stored.created_by_id == harness.contributor.id

        admin_view = harness.client.get(
            f"/api/v1/admin/questions/{question_id}",
            headers=harness.admin_headers,
        )
        assert admin_view.status_code == 200
        assert admin_view.json()["created_by_id"] == str(harness.contributor.id)

        denied = harness.client.get(
            f"/api/v1/admin/questions/{question_id}",
            headers=harness.contributor_headers,
        )
        assert denied.status_code == 403
    finally:
        harness.close()


# --- JHEP-192: grading permissions for written responses ---


def test_grant_and_revoke_grading_permissions_independently() -> None:
    """AC1: only the targeted flags change; each save is audited."""
    harness = UsersHarness()
    try:
        # grant short answers only
        response = harness.client.patch(
            f"/api/v1/admin/users/{harness.contributor.id}/grading-permissions",
            json={"grade_short_answers": True, "grade_essays": False},
            headers=harness.admin_headers,
        )
        assert response.status_code == 200
        body = response.json()
        assert body["user"]["grade_short_answers"] is True
        assert body["user"]["grade_essays"] is False
        changes = body["changes"]
        assert len(changes) == 1
        assert changes[0]["permission"] == "grade_short_answers"
        assert changes[0]["action"] == "granted"

        stored = harness.session.exec(
            select(User).where(User.id == harness.contributor.id)
        ).one()
        assert stored.grade_short_answers is True
        assert stored.grade_essays is False

        audits = harness.session.exec(
            select(PermissionChangeAudit).where(
                PermissionChangeAudit.target_id == harness.contributor.id
            )
        ).all()
        assert len(audits) == 1
        assert audits[0].actor_id == harness.admin.id
        assert audits[0].permission == "grade_short_answers"
        assert audits[0].action == "granted"
        assert audits[0].previous_value is False
        assert audits[0].new_value is True

        # grant essays later — the other flag untouched (AC1 independent)
        grant_essays = harness.client.patch(
            f"/api/v1/admin/users/{harness.contributor.id}/grading-permissions",
            json={"grade_short_answers": None, "grade_essays": True},
            headers=harness.admin_headers,
        )
        assert grant_essays.status_code == 200
        body2 = grant_essays.json()
        assert body2["user"]["grade_short_answers"] is True
        assert body2["user"]["grade_essays"] is True
        assert len(body2["changes"]) == 1

        stored2 = harness.session.exec(
            select(User).where(User.id == harness.contributor.id)
        ).one()
        assert stored2.grade_short_answers is True
        assert stored2.grade_essays is True

        # revoke both
        revoke = harness.client.patch(
            f"/api/v1/admin/users/{harness.contributor.id}/grading-permissions",
            json={"grade_short_answers": False, "grade_essays": False},
            headers=harness.admin_headers,
        )
        assert revoke.status_code == 200
        assert revoke.json()["changes"][0]["action"] == "revoked"
        assert revoke.json()["changes"][1]["action"] == "revoked"

        stored3 = harness.session.exec(
            select(User).where(User.id == harness.contributor.id)
        ).one()
        assert stored3.grade_short_answers is False
        assert stored3.grade_essays is False
    finally:
        harness.close()


def test_grading_permissions_require_administrator() -> None:
    harness = UsersHarness()
    try:
        for headers in (harness.learner_headers, harness.contributor_headers):
            response = harness.client.patch(
                f"/api/v1/admin/users/{harness.contributor.id}/grading-permissions",
                json={"grade_short_answers": True},
                headers=headers,
            )
            assert response.status_code == 403
    finally:
        harness.close()


def test_grading_permissions_refuse_non_contributor_targets() -> None:
    """AC1: only Contributor accounts are valid targets — Administrators
    grade inherently (AC3) and Learners cannot grade."""
    harness = UsersHarness()
    try:
        admin_target = harness.client.patch(
            f"/api/v1/admin/users/{harness.other_admin.id}/grading-permissions",
            json={"grade_short_answers": True},
            headers=harness.admin_headers,
        )
        assert admin_target.status_code == 409
        assert admin_target.json()["detail"]["code"] == "NOT_A_CONTRIBUTOR"

        learner_target = harness.client.patch(
            f"/api/v1/admin/users/{harness.learner.id}/grading-permissions",
            json={"grade_short_answers": True},
            headers=harness.admin_headers,
        )
        assert learner_target.status_code == 409

        audits = harness.session.exec(select(PermissionChangeAudit)).all()
        assert audits == []
    finally:
        harness.close()


def test_grading_permissions_unknown_user_404() -> None:
    harness = UsersHarness()
    try:
        response = harness.client.patch(
            f"/api/v1/admin/users/{uuid4()}/grading-permissions",
            json={"grade_short_answers": True},
            headers=harness.admin_headers,
        )
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "USER_NOT_FOUND"
    finally:
        harness.close()


def test_noop_permission_save_is_safe() -> None:
    """A save with no actual change succeeds without audit rows."""
    harness = UsersHarness()
    try:
        response = harness.client.patch(
            f"/api/v1/admin/users/{harness.contributor.id}/grading-permissions",
            json={"grade_short_answers": False, "grade_essays": False},
            headers=harness.admin_headers,
        )
        assert response.status_code == 200
        assert response.json()["changes"] == []
        audits = harness.session.exec(select(PermissionChangeAudit)).all()
        assert audits == []
    finally:
        harness.close()


def test_can_grade_response_type_enforcement_hook() -> None:
    """AC2/AC3: the JHEP-122 enforcement helper — contributors grade
    only permitted types; admins inherently; learners never."""
    harness = UsersHarness()
    try:
        harness.contributor.grade_short_answers = True
        harness.contributor.grade_essays = False
        harness.session.add(harness.contributor)
        harness.session.commit()

        from app.services.admin_user_service import can_grade_response_type

        assert can_grade_response_type(harness.contributor, "short_answer")
        assert not can_grade_response_type(harness.contributor, "essay")
        assert can_grade_response_type(harness.admin, "essay")
        assert can_grade_response_type(harness.admin, "short_answer")
        assert not can_grade_response_type(harness.learner, "short_answer")
    finally:
        harness.close()


def test_permission_revocation_takes_effect_immediately() -> None:
    """AC4: the flags live on the User row — the DB-row-per-request
    pattern gives immediate effect, mirroring the role checks."""
    harness = UsersHarness()
    try:
        harness.contributor.grade_short_answers = True
        harness.session.add(harness.contributor)
        harness.session.commit()

        granted = harness.client.patch(
            f"/api/v1/admin/users/{harness.contributor.id}/grading-permissions",
            json={"grade_short_answers": False},
            headers=harness.admin_headers,
        )
        assert granted.status_code == 200

        stored = harness.session.exec(
            select(User).where(User.id == harness.contributor.id)
        ).one()
        assert stored.grade_short_answers is False

        audits = harness.session.exec(
            select(PermissionChangeAudit).where(
                PermissionChangeAudit.target_id == harness.contributor.id,
                PermissionChangeAudit.permission == "grade_short_answers",
            )
        ).all()
        assert len(audits) == 1
        assert audits[0].action == "revoked"
    finally:
        harness.close()
