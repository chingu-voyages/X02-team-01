"""JHEP-115 — Administrator dashboard overview and activity KPIs.

Covers AC1 (admin-only access), AC2 (registered learners), AC3/AC4
(completed attempts + participating learners incl. retakes and the
duplicate-submit rule), AC5 (pending question reviews + breakdown),
AC6 (attempts-by-exam table sums to the total), AC7 (UTC period and
custom date filters) and the legacy-NULL-exam row.
"""

import json
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

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
    PracticeExam,
    Question,
    QuestionVersion,
    User,
)
from tests.admin_auth_fixtures import domain_access_token


@compiles(JSONB, "sqlite")
def _jsonb_on_sqlite(_type, _compiler, **_kw) -> str:
    return "JSON"


def _create_user(
    session: Session,
    *,
    email: str,
    password: str,
    role: str,
) -> User:
    user = User(
        email=email,
        full_name=email.split("@")[0],
        hashed_password=hash_password(password),
        role=role,
        is_verified=True,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


@sa.event.listens_for(sa.engine.Engine, "connect")
def _sqlite_compat(dbapi_connection, _connection_record) -> None:
    """Mirror the JHEP-122 harness: SQLite-compatible Postgres SQL."""
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
    dbapi_connection.create_function("now", 0, lambda: "")


class DashboardHarness:
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
                Certification.__table__,
                Category.__table__,
                PracticeExam.__table__,
                ExamAttempt.__table__,
                ExamAttemptQuestion.__table__,
                ExamResponse.__table__,
                ExamQuestionGrade.__table__,
                ExamResult.__table__,
                Question.__table__,
                QuestionVersion.__table__,
            ],
        )
        self.session = Session(self.engine)

        self.admin = _create_user(
            self.session,
            email=f"admin-{uuid4().hex[:8]}@example.test",
            password="AdminPass1!",
            role="administrator",
        )
        # JHEP-207: administrators must be MFA-enrolled before any admin
        # API call is accepted — model confirmed enrollment like the
        # shared domain fixtures do.
        enrolled_at = datetime.now(UTC)
        self.admin.totp_secret_encrypted = "test-encrypted-secret"
        self.admin.mfa_enrolled_at = enrolled_at
        self.admin.sessions_invalid_before = enrolled_at
        self.session.add(self.admin)
        self.session.commit()
        self.session.refresh(self.admin)
        self.learner = _create_user(
            self.session,
            email=f"learner-{uuid4().hex[:8]}@example.test",
            password="LearnerPass1!",
            role="learner",
        )
        self.contributor = _create_user(
            self.session,
            email=f"contrib-{uuid4().hex[:8]}@example.test",
            password="ContribPass1!",
            role="contributor",
        )

        self.certification = Certification(
            name="Dashboard Cert",
            code=f"DC-{uuid4().hex[:8]}",
            passing_threshold_pct=70,
        )
        self.session.add(self.certification)
        self.session.commit()
        self.session.refresh(self.certification)

        self.category = Category(
            certification_id=self.certification.id,
            name="Dashboard Category",
        )
        self.session.add(self.category)
        self.session.commit()
        self.session.refresh(self.category)

        self.practice_exam = PracticeExam(
            certification_id=self.certification.id,
            category_id=self.category.id,
            name="Dashboard Practice Exam",
            question_count=2,
            status="published",
        )
        self.session.add(self.practice_exam)
        self.session.commit()
        self.session.refresh(self.practice_exam)

        def override_session() -> Iterator[Session]:
            yield self.session

        app.dependency_overrides[get_session] = override_session
        self.client = TestClient(app)
        self.admin_headers = {
            "Authorization": f"Bearer {domain_access_token(self.admin)}"
        }
        self.learner_headers = {
            "Authorization": f"Bearer {domain_access_token(self.learner)}"
        }
        self.contributor_headers = {
            "Authorization": f"Bearer {domain_access_token(self.contributor)}"
        }

    def overview(self, params: str = "") -> dict:
        response = self.client.get(
            f"/api/v1/admin/dashboard/overview{params}",
            headers=self.admin_headers,
        )
        assert response.status_code == 200, response.text
        return response.json()

    def close(self) -> None:
        app.dependency_overrides.pop(get_session, None)
        self.client.close()
        self.session.close()
        self.engine.dispose()


def _completed_attempt(
    harness: DashboardHarness,
    *,
    user_id,
    submitted_at,
    practice_exam_id=None,
) -> ExamAttempt:
    attempt = ExamAttempt(
        user_id=user_id,
        certification_id=harness.certification.id,
        practice_exam_id=practice_exam_id,
        status="submitted",
        question_count=1,
        passing_threshold_pct=70,
        submitted_at=submitted_at,
    )
    harness.session.add(attempt)
    harness.session.commit()
    harness.session.refresh(attempt)
    return attempt


@pytest.fixture
def harness():
    dashboard = DashboardHarness()
    try:
        yield dashboard
    finally:
        dashboard.close()


def test_requires_administrator(harness: DashboardHarness) -> None:
    # AC1: anonymous requests are refused outright.
    assert harness.client.get("/api/v1/admin/dashboard/overview").status_code == 401

    assert (
        harness.client.get(
            "/api/v1/admin/dashboard/overview", headers=harness.learner_headers
        ).status_code
        == 403
    )

    assert (
        harness.client.get(
            "/api/v1/admin/dashboard/overview", headers=harness.contributor_headers
        ).status_code
        == 403
    )


def test_registered_learners_counts_roles_and_excludes_admins(
    harness: DashboardHarness,
) -> None:
    data = harness.overview()

    # Two accounts (learner + contributor); the administrator is excluded.
    assert data["registered_learners"] == 2


def test_completed_attempts_include_retakes_once(harness: DashboardHarness) -> None:
    now = datetime.now(UTC)

    # One learner with two retakes on the same exam counts two attempts
    # (AC3) but one participating learner (AC4).
    _completed_attempt(
        harness,
        user_id=harness.learner.id,
        submitted_at=now - timedelta(days=2),
        practice_exam_id=harness.practice_exam.id,
    )
    _completed_attempt(
        harness,
        user_id=harness.learner.id,
        submitted_at=now - timedelta(days=1),
        practice_exam_id=harness.practice_exam.id,
    )
    # One attempt outside the 30-day window (older than the boundary).
    _completed_attempt(
        harness,
        user_id=harness.contributor.id,
        submitted_at=now - timedelta(days=45),
        practice_exam_id=harness.practice_exam.id,
    )
    # One legacy attempt without an exam id.
    _completed_attempt(
        harness,
        user_id=harness.contributor.id,
        submitted_at=now - timedelta(hours=3),
    )
    # Incomplete attempts are excluded.
    harness.session.add(
        ExamAttempt(
            user_id=harness.learner.id,
            certification_id=harness.certification.id,
            practice_exam_id=harness.practice_exam.id,
            status="in_progress",
            question_count=1,
            passing_threshold_pct=70,
        )
    )
    harness.session.commit()

    data = harness.overview("?period=30")

    assert data["completed_attempts"] == 3
    assert data["participating_learners"] == 2

    table = {row["title"]: row["count"] for row in data["attempts_by_exam"]}
    assert table["Dashboard Practice Exam"] == 2
    assert table["Legacy (earlier exams)"] == 1
    assert (
        sum(row["count"] for row in data["attempts_by_exam"])
        == (data["completed_attempts"])
    )

    # Highest count first (AC6).
    counts = [row["count"] for row in data["attempts_by_exam"]]
    assert counts == sorted(counts, reverse=True)


def test_period_filters_apply_to_utc_window(harness: DashboardHarness) -> None:
    now = datetime.now(UTC)

    _completed_attempt(
        harness,
        user_id=harness.learner.id,
        submitted_at=now - timedelta(days=2),
    )
    _completed_attempt(
        harness,
        user_id=harness.learner.id,
        submitted_at=now - timedelta(days=45),
    )

    last7 = harness.overview("?period=7")
    assert last7["completed_attempts"] == 1

    all_time = harness.overview("?period=all")
    assert all_time["completed_attempts"] == 2

    # Inclusive custom date window covering both attempts.
    start = (now - timedelta(days=45)).strftime("%Y-%m-%d")
    end = now.strftime("%Y-%m-%d")
    custom = harness.overview(f"?period=custom&from={start}&to={end}")
    assert custom["completed_attempts"] == 2

    # Excluded custom window (before both attempts).
    early = harness.overview("?period=custom&from=2020-01-01&to=2020-01-02")
    assert early["completed_attempts"] == 0
    assert early["participating_learners"] == 0


def test_exam_filter_scopes_the_attempt_set(harness: DashboardHarness) -> None:
    now = datetime.now(UTC)

    _completed_attempt(
        harness,
        user_id=harness.learner.id,
        submitted_at=now - timedelta(days=1),
        practice_exam_id=harness.practice_exam.id,
    )
    _completed_attempt(
        harness,
        user_id=harness.contributor.id,
        submitted_at=now - timedelta(days=1),
    )

    scoped = harness.overview(f"?period=30&exam_id={harness.practice_exam.id}")
    assert scoped["completed_attempts"] == 1
    assert scoped["participating_learners"] == 1
    assert scoped["attempts_by_exam"][0]["exam_id"] == str(harness.practice_exam.id)


def test_invalid_period_is_actionable(harness: DashboardHarness) -> None:
    response = harness.client.get(
        "/api/v1/admin/dashboard/overview?period=42",
        headers=harness.admin_headers,
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "INVALID_PERIOD"

    inverted = harness.client.get(
        "/api/v1/admin/dashboard/overview?period=custom&from=2026-05-01&to=2026-04-01",
        headers=harness.admin_headers,
    )
    assert inverted.status_code == 422


def test_pending_question_reviews_snapshot(harness: DashboardHarness) -> None:
    # One question whose latest version is submitted, one in_review, one
    # draft-only, one approved — only the first two count (AC5).
    for status, position in (
        ("submitted", 1),
        ("in_review", 2),
        ("pending", 3),
        ("approved", 4),
    ):
        question = Question(
            certification_id=harness.certification.id,
            category_id=harness.category.id,
            difficulty="easy",
            created_by_id=harness.contributor.id,
        )
        harness.session.add(question)
        harness.session.commit()
        harness.session.refresh(question)
        harness.session.add(
            QuestionVersion(
                question_id=question.id,
                version_number=1,
                question_text=f"Question {position}?",
                question_type="multiple_choice",
                allows_multiple_answers=False,
                review_status=status,
                publication_status="draft",
                is_flagged=False,
                submitted_by_id=harness.contributor.id,
                reviewed_by_id=(
                    harness.contributor.id if status == "approved" else None
                ),
                reviewed_at=(datetime.now(UTC) if status == "approved" else None),
            )
        )
    harness.session.commit()

    data = harness.overview()

    assert data["pending_question_reviews"] == 2
    assert data["review_breakdown"] == {"submitted": 1, "in_review": 1}
    assert (
        data["review_breakdown"]["submitted"] + data["review_breakdown"]["in_review"]
        == data["pending_question_reviews"]
    )

    # Snapshots are unaffected by the period filter (AC7).
    filtered = harness.overview("?period=7")
    assert filtered["pending_question_reviews"] == 2
    assert filtered["registered_learners"] == data["registered_learners"]


def test_latest_version_determines_review_state(
    harness: DashboardHarness,
) -> None:
    """A question whose latest version is approved no longer counts even
    when an older version was submitted (return-to-draft semantics)."""
    question = Question(
        certification_id=harness.certification.id,
        category_id=harness.category.id,
        difficulty="easy",
        created_by_id=harness.contributor.id,
    )
    harness.session.add(question)
    harness.session.commit()
    harness.session.refresh(question)

    for version_number, status in ((1, "submitted"), (2, "approved")):
        harness.session.add(
            QuestionVersion(
                question_id=question.id,
                version_number=version_number,
                question_text=f"Version {version_number}",
                question_type="multiple_choice",
                allows_multiple_answers=False,
                review_status=status,
                publication_status=("draft" if version_number == 1 else "active"),
                is_flagged=False,
                submitted_by_id=harness.contributor.id,
                reviewed_by_id=(
                    harness.contributor.id if status == "approved" else None
                ),
                reviewed_at=datetime.now(UTC) if status == "approved" else None,
            )
        )
    harness.session.commit()

    data = harness.overview()
    assert data["pending_question_reviews"] == 0
