"""JHEP-122 — Manual review and grading of written responses.

Covers the queue, the per-type permission gates for viewing/history/
grading, score validation, revision history, result recalculation, and
immediate revocation. A SQLite harness keeps these checks fast while
mirroring the production tables (JSONB is compiled to JSON for SQLite).
"""

import json
from collections.abc import Iterator
from datetime import UTC, datetime
from decimal import Decimal
from uuid import uuid4

import pytest
import sqlalchemy as sa
from admin_auth_fixtures import sign_in_administrator
from fastapi.testclient import TestClient
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.core.security import hash_password
from app.db.session import get_session
from app.main import app
from app.models import (
    Category,
    Certification,
    ExamAttempt,
    ExamAttemptQuestion,
    ExamQuestionGrade,
    ExamResponse,
    ExamResult,
    ManualGradeHistory,
    MfaLoginChallenge,
    MfaRecoveryCode,
    PracticeExam,
    Question,
    QuestionVersion,
    TextAnswerKey,
    User,
)

pytestmark = pytest.mark.usefixtures("isolated_mfa_configuration")


@compiles(JSONB, "sqlite")
def _jsonb_on_sqlite(_type, _compiler, **_kw) -> str:
    return "JSON"


@sa.event.listens_for(sa.engine.Engine, "connect")
def _sqlite_compat(dbapi_connection, _connection_record) -> None:
    if dbapi_connection.__class__.__module__ != "sqlite3":
        return
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()
    dbapi_connection.create_function(
        "jsonb_typeof",
        1,
        lambda value: (
            "array"
            if isinstance(value, str) and value.startswith("[")
            else "null"
            if value is None
            else "object"
        ),
    )
    dbapi_connection.create_function(
        "jsonb_array_length",
        1,
        lambda value: (
            len(json.loads(value))
            if isinstance(value, str) and value.startswith("[")
            else 0
        ),
    )
    dbapi_connection.create_function(
        "btrim", 1, lambda value: value.strip() if isinstance(value, str) else value
    )
    dbapi_connection.create_function("now", 0, lambda: datetime.now(UTC).isoformat())


class GradingHarness:
    """A submitted short answer with three reviewer identities."""

    def __init__(self, question_type: str = "short_answer") -> None:
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
                PracticeExam.__table__,
                Question.__table__,
                QuestionVersion.__table__,
                TextAnswerKey.__table__,
                ExamAttempt.__table__,
                ExamAttemptQuestion.__table__,
                ExamResponse.__table__,
                ExamQuestionGrade.__table__,
                ExamResult.__table__,
                ManualGradeHistory.__table__,
            ],
        )
        self.session = Session(self.engine)
        suffix = uuid4().hex[:8]
        self.admin = self._user(f"admin-{suffix}@example.test", "administrator")
        self.contributor = self._user(f"grader-{suffix}@example.test", "contributor")
        self.contributor.grade_short_answers = True
        self.unauthorized = self._user(f"other-{suffix}@example.test", "contributor")
        self.learner = self._user(f"learner-{suffix}@example.test", "learner")

        certification = Certification(
            name="Manual Grading Certification",
            code=f"MG-{suffix}",
            passing_threshold_pct=70,
        )
        self.session.add(certification)
        self.session.commit()
        self.session.refresh(certification)
        category = Category(
            certification_id=certification.id,
            name="Written Responses",
        )
        self.session.add(category)
        self.session.commit()
        self.session.refresh(category)

        question = Question(
            certification_id=certification.id,
            category_id=category.id,
            difficulty="medium",
            created_by_id=self.admin.id,
        )
        self.session.add(question)
        self.session.commit()
        self.session.refresh(question)
        version = QuestionVersion(
            question_id=question.id,
            version_number=1,
            question_text="Explain the difference between the two concepts.",
            question_type=question_type,
            submitted_by_id=self.admin.id,
        )
        self.session.add(version)
        self.session.commit()
        self.session.refresh(version)
        self.session.add(
            TextAnswerKey(
                question_version_id=version.id,
                expected_answer="A complete explanation mentions both concepts.",
                max_points=2,
            )
        )
        attempt = ExamAttempt(
            user_id=self.learner.id,
            certification_id=certification.id,
            status="submitted",
            question_count=1,
            passing_threshold_pct=70,
            submitted_at=datetime.now(UTC),
        )
        self.session.add(attempt)
        self.session.commit()
        self.session.refresh(attempt)
        response = ExamResponse(
            attempt_id=attempt.id,
            question_id=question.id,
            question_version_id=version.id,
            position=1,
            text_response="They differ in scope and application.",
            is_submitted=True,
            question_submitted_at=datetime.now(UTC),
        )
        self.session.add(response)
        self.session.add(
            ExamAttemptQuestion(
                attempt_id=attempt.id,
                question_id=question.id,
                question_version_id=version.id,
                position=1,
            )
        )
        self.session.add(
            ExamQuestionGrade(
                attempt_id=attempt.id,
                question_id=question.id,
                question_version_id=version.id,
                outcome="ungraded",
                points_earned=0,
            )
        )
        self.session.add(
            ExamResult(
                attempt_id=attempt.id,
                points_earned=0,
                points_possible=0,
                score_pct=Decimal(0),
                threshold_pct=70,
                passed=None,
            )
        )
        self.session.commit()
        self.session.refresh(response)
        self.question_id = question.id
        self.version_id = version.id
        self.attempt_id = attempt.id
        self.response_id = response.id

        def override_session() -> Iterator[Session]:
            yield self.session

        app.dependency_overrides[get_session] = override_session
        self.client = TestClient(app)
        admin_login = sign_in_administrator(self.client, self.admin.email, "Passw0rd!")
        self.admin_headers = {"Authorization": f"Bearer {admin_login['access_token']}"}
        self.contributor_headers = self._login(self.contributor.email, "Passw0rd!")
        self.unauthorized_headers = self._login(self.unauthorized.email, "Passw0rd!")
        self.learner_headers = self._login(self.learner.email, "Passw0rd!")

    def _user(self, email: str, role: str) -> User:
        user = User(
            email=email,
            full_name=role.title(),
            hashed_password=hash_password("Passw0rd!"),
            role=role,
            is_verified=True,
        )
        self.session.add(user)
        self.session.commit()
        self.session.refresh(user)
        return user

    def _login(self, email: str, password: str) -> dict[str, str]:
        response = self.client.post(
            "/api/v1/auth/login", json={"email": email, "password": password}
        )
        assert response.status_code == 200, response.text
        return {"Authorization": f"Bearer {response.json()['access_token']}"}

    def close(self) -> None:
        app.dependency_overrides.pop(get_session, None)
        self.client.close()
        self.session.close()
        self.engine.dispose()

    @property
    def detail_path(self) -> str:
        return f"/api/v1/admin/grading/responses/{self.attempt_id}/{self.version_id}"

    @property
    def grade_path(self) -> str:
        return f"{self.detail_path}/grade"

    def grade(self, headers: dict[str, str], score: object, **extra) -> object:
        return self.client.post(
            self.grade_path,
            headers=headers,
            json={"score": score, **extra},
        )


def test_own_permissions_are_read_from_the_database() -> None:
    harness = GradingHarness()
    try:
        admin = harness.client.get(
            "/api/v1/auth/grading-permissions", headers=harness.admin_headers
        )
        assert admin.status_code == 200, admin.text
        assert admin.json() == {"short_answer": True, "essay": True}

        contributor = harness.client.get(
            "/api/v1/auth/grading-permissions",
            headers=harness.contributor_headers,
        )
        assert contributor.json() == {"short_answer": True, "essay": False}

        learner = harness.client.get(
            "/api/v1/auth/grading-permissions", headers=harness.learner_headers
        )
        assert learner.status_code == 403, learner.text

        harness.unauthorized.grade_short_answers = True
        harness.session.add(harness.unauthorized)
        harness.session.commit()
        changed = harness.client.get(
            "/api/v1/auth/grading-permissions",
            headers=harness.unauthorized_headers,
        )
        assert changed.json()["short_answer"] is True
    finally:
        harness.close()


def test_pending_queue_and_explicit_type_gate() -> None:
    harness = GradingHarness()
    try:
        allowed = harness.client.get(
            "/api/v1/admin/grading/pending", headers=harness.contributor_headers
        )
        assert allowed.status_code == 200, allowed.text
        assert allowed.json()["count"] == 1
        item = allowed.json()["items"][0]
        assert item["response_type"] == "short_answer"
        assert item["max_points"] == 2

        denied = harness.client.get(
            "/api/v1/admin/grading/pending?response_type=essay",
            headers=harness.contributor_headers,
        )
        assert denied.status_code == 403, denied.text
        assert denied.json()["detail"]["code"] == "GRADING_PERMISSION_DENIED"

        unauthorized = harness.client.get(
            "/api/v1/admin/grading/pending",
            headers=harness.unauthorized_headers,
        )
        assert unauthorized.json()["count"] == 0
    finally:
        harness.close()


def test_detail_and_history_are_permission_gated() -> None:
    harness = GradingHarness()
    try:
        detail = harness.client.get(
            harness.detail_path, headers=harness.contributor_headers
        )
        assert detail.status_code == 200, detail.text
        body = detail.json()
        assert body["learner_response"] == "They differ in scope and application."
        assert body["expected_answer"].startswith("A complete explanation")
        assert body["max_points"] == 2
        assert body["current_grade"]["outcome"] == "ungraded"
        assert body["provisional_ai_feedback"]["available"] is False
        assert "context only" in body["provisional_ai_feedback"]["label"]

        for headers in (harness.unauthorized_headers, harness.learner_headers):
            denied = harness.client.get(harness.detail_path, headers=headers)
            assert denied.status_code == 403, denied.text
            history = harness.client.get(
                f"{harness.detail_path}/history", headers=headers
            )
            assert history.status_code == 403, history.text

        missing = harness.client.get(
            f"/api/v1/admin/grading/responses/{uuid4()}/{harness.version_id}",
            headers=harness.admin_headers,
        )
        assert missing.status_code == 404, missing.text
    finally:
        harness.close()


def test_invalid_scores_are_rejected_without_mutating() -> None:
    harness = GradingHarness()
    try:
        for score in (-1, 3, 1.5, "two", None):
            response = harness.grade(harness.admin_headers, score)
            assert response.status_code == 422, (score, response.text)
            if score == 3:
                assert response.json()["detail"]["code"] == "INVALID_SCORE"
            else:
                assert isinstance(response.json()["detail"], list)

        extra = harness.client.post(
            harness.grade_path,
            headers=harness.admin_headers,
            json={"score": 1, "outcome": "correct"},
        )
        assert extra.status_code == 422, extra.text

        grade = harness.session.exec(
            select(ExamQuestionGrade).where(
                ExamQuestionGrade.attempt_id == harness.attempt_id
            )
        ).one()
        assert grade.outcome == "ungraded"
        assert harness.session.exec(select(ManualGradeHistory)).all() == []
    finally:
        harness.close()


def test_final_grade_revision_and_result_recalculation() -> None:
    harness = GradingHarness()
    try:
        first = harness.grade(harness.contributor_headers, 2, feedback="Excellent")
        assert first.status_code == 200, first.text
        body = first.json()
        assert body["action"] == "graded"
        assert body["grader_role"] == "contributor"
        assert body["score"] == 2

        grade = harness.session.exec(
            select(ExamQuestionGrade).where(
                ExamQuestionGrade.attempt_id == harness.attempt_id
            )
        ).one()
        assert grade.outcome == "manually_graded"
        assert grade.graded_by_id == harness.contributor.id
        assert grade.graded_at is not None
        assert grade.feedback == "Excellent"

        result = harness.session.exec(
            select(ExamResult).where(ExamResult.attempt_id == harness.attempt_id)
        ).one()
        assert (result.points_earned, result.points_possible) == (2, 2)
        assert float(result.score_pct) == 100.0
        assert result.passed is True

        response = harness.session.get(ExamResponse, harness.response_id)
        assert response is not None and response.graded_at is not None

        revised = harness.grade(harness.admin_headers, 1, feedback="Overstated")
        assert revised.status_code == 200, revised.text
        assert revised.json()["action"] == "revised"
        assert revised.json()["grader_role"] == "administrator"

        history = harness.client.get(
            f"{harness.detail_path}/history", headers=harness.admin_headers
        )
        assert history.status_code == 200, history.text
        items = history.json()["items"]
        assert [item["action"] for item in items] == ["graded", "revised"]
        assert [item["score"] for item in items] == [2, 1]

        result = harness.session.exec(
            select(ExamResult).where(ExamResult.attempt_id == harness.attempt_id)
        ).one()
        assert (result.points_earned, result.points_possible) == (1, 2)
        assert float(result.score_pct) == 50.0
        assert result.passed is False

        pending = harness.client.get(
            "/api/v1/admin/grading/pending", headers=harness.admin_headers
        )
        assert pending.json()["count"] == 0

        detail = harness.client.get(harness.detail_path, headers=harness.admin_headers)
        assert detail.json()["current_grade"]["graded_at"] is not None
    finally:
        harness.close()


def test_revoked_permission_blocks_new_actions_but_keeps_history() -> None:
    harness = GradingHarness()
    try:
        first = harness.grade(harness.contributor_headers, 2)
        assert first.status_code == 200, first.text

        harness.contributor.grade_short_answers = False
        harness.session.add(harness.contributor)
        harness.session.commit()

        denied = harness.grade(harness.contributor_headers, 0)
        assert denied.status_code == 403, denied.text
        detail = harness.client.get(
            harness.detail_path, headers=harness.contributor_headers
        )
        assert detail.status_code == 403, detail.text

        history = harness.session.exec(select(ManualGradeHistory)).all()
        assert len(history) == 1
        assert history[0].action == "graded"
        assert history[0].score == 2
    finally:
        harness.close()


def test_unsubmitted_response_is_not_gradable() -> None:
    harness = GradingHarness()
    try:
        response = harness.session.get(ExamResponse, harness.response_id)
        assert response is not None
        response.is_submitted = False
        harness.session.add(response)
        harness.session.commit()

        result = harness.grade(harness.admin_headers, 1)
        assert result.status_code == 409, result.text
        assert result.json()["detail"]["code"] == "RESPONSE_NOT_GRADABLE"
    finally:
        harness.close()


def test_learner_results_wait_for_the_human_grade() -> None:
    harness = GradingHarness()
    try:
        url = f"/api/v1/exams/{harness.attempt_id}/results"

        def learner_results() -> dict:
            response = harness.client.get(url, headers=harness.learner_headers)
            assert response.status_code == 200, response.text
            return response.json()

        pending = learner_results()
        assert pending["grading_complete"] is False
        assert pending["pending_manual_grading_count"] == 1
        assert pending["passed"] is None
        assert pending["graded_count"] == 0
        line = pending["questions"][0]
        assert line["status"] == "pending_manual_grading"
        assert line["position"] == 1
        assert line["learner_response"] == "They differ in scope and application."
        assert line["feedback"] is None
        assert "expected_answer" not in line

        graded = harness.grade(harness.admin_headers, 2, feedback="Clear answer")
        assert graded.status_code == 200, graded.text

        complete = learner_results()
        assert complete["grading_complete"] is True
        assert complete["pending_manual_grading_count"] == 0
        assert complete["graded_count"] == 1
        assert complete["points_earned"] == 2
        assert complete["passed"] is True
        line = complete["questions"][0]
        assert line["status"] == "graded"
        assert line["outcome"] == "manually_graded"
        assert line["points_earned"] == 2
        assert line["max_points"] == 2
        assert line["feedback"] == "Clear answer"

        revised = harness.grade(harness.admin_headers, 0)
        assert revised.status_code == 200, revised.text
        after_revision = learner_results()
        assert after_revision["grading_complete"] is True
        assert after_revision["passed"] is False
        assert len(after_revision["questions"]) == 1
        assert after_revision["questions"][0]["points_earned"] == 0
    finally:
        harness.close()


def test_essay_gate_follows_the_response_type() -> None:
    harness = GradingHarness(question_type="essay")
    try:
        queue = "/api/v1/admin/grading/pending?response_type=essay"
        denied_queue = harness.client.get(queue, headers=harness.contributor_headers)
        assert denied_queue.status_code == 403, denied_queue.text
        assert denied_queue.json()["detail"]["code"] == "GRADING_PERMISSION_DENIED"

        denied_detail = harness.client.get(
            harness.detail_path, headers=harness.contributor_headers
        )
        assert denied_detail.status_code == 403, denied_detail.text
        denied_grade = harness.grade(harness.contributor_headers, 1)
        assert denied_grade.status_code == 403, denied_grade.text

        harness.contributor.grade_essays = True
        harness.session.add(harness.contributor)
        harness.session.commit()

        allowed = harness.client.get(
            harness.detail_path, headers=harness.contributor_headers
        )
        assert allowed.status_code == 200, allowed.text
        assert allowed.json()["response_type"] == "essay"
        allowed_queue = harness.client.get(queue, headers=harness.contributor_headers)
        assert allowed_queue.status_code == 200, allowed_queue.text
        assert len(allowed_queue.json()["items"]) == 1
        assert allowed_queue.json()["items"][0]["response_type"] == "essay"

        graded = harness.grade(harness.contributor_headers, 1)
        assert graded.status_code == 200, graded.text
        assert graded.json()["score"] == 1
    finally:
        harness.close()
