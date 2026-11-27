"""JHEP-207: safe deletion of practice exam configurations."""

from collections.abc import Iterator
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from admin_auth_fixtures import domain_access_token, make_domain_user
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.api.v1.endpoints import admin_practice_exams
from app.db.session import get_session
from app.models import (
    AnswerOption,
    Category,
    Certification,
    ExamAttempt,
    ExamAttemptQuestion,
    ExamQuestionGrade,
    ExamResult,
    PracticeExam,
    Question,
    QuestionVersion,
    User,
)

ADMIN = "/api/v1/admin/practice-exams"


@pytest.fixture
def environment() -> Iterator[tuple[TestClient, Session]]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _record):
        connection.execute("PRAGMA foreign_keys=ON")

    SQLModel.metadata.create_all(
        engine,
        tables=[
            User.__table__,
            Certification.__table__,
            Category.__table__,
            PracticeExam.__table__,
            Question.__table__,
            QuestionVersion.__table__,
            AnswerOption.__table__,
            ExamAttempt.__table__,
            ExamAttemptQuestion.__table__,
            ExamQuestionGrade.__table__,
            ExamResult.__table__,
        ],
    )
    app = FastAPI()
    app.include_router(admin_practice_exams.router, prefix=ADMIN)
    try:
        with Session(engine) as session:

            def override_session() -> Iterator[Session]:
                yield session

            app.dependency_overrides[get_session] = override_session
            with TestClient(app) as client:
                yield client, session
    finally:
        engine.dispose()


def _user(session: Session, role: str = "administrator") -> User:
    user = make_domain_user(
        email=f"{uuid4()}@example.test", role=role, is_verified=True
    )
    session.add(user)
    session.commit()
    return user


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {domain_access_token(user)}"}


def _seed(session: Session, admin: User, *, exam_status: str = "draft"):
    cert = Certification(
        name="Deletion regression",
        code=f"DELETE-{uuid4().hex[:8]}",
        passing_threshold_pct=70,
        is_published=True,
    )
    session.add(cert)
    session.flush()
    category = Category(
        certification_id=cert.id, name="Fundamentals", is_published=True
    )
    session.add(category)
    session.flush()
    question = Question(
        certification_id=cert.id,
        category_id=category.id,
        difficulty="easy",
        created_by_id=admin.id,
    )
    session.add(question)
    session.flush()
    version = QuestionVersion(
        question_id=question.id,
        version_number=1,
        question_text="Which option is correct?",
        question_type="multiple_choice",
        allows_multiple_answers=False,
        review_status="approved",
        publication_status="active",
        submitted_by_id=admin.id,
        reviewed_by_id=admin.id,
        reviewed_at=datetime.now(UTC),
    )
    session.add(version)
    session.flush()
    session.add_all(
        [
            AnswerOption(
                question_version_id=version.id,
                position=1,
                option_text="Correct",
                is_correct=True,
            ),
            AnswerOption(
                question_version_id=version.id,
                position=2,
                option_text="Incorrect",
                is_correct=False,
            ),
        ]
    )
    exam = PracticeExam(
        certification_id=cert.id,
        category_id=category.id,
        name="Exam to delete",
        question_count=1,
        status=exam_status,
    )
    sibling = PracticeExam(
        certification_id=cert.id,
        category_id=category.id,
        name="Independent sibling exam",
        question_count=1,
        status="draft",
    )
    session.add_all([exam, sibling])
    session.commit()
    return exam, sibling, question, version


def _snapshot_ids(session: Session) -> dict[str, set[UUID]]:
    """The exam configuration is the only record deletion may remove."""
    return {
        model.__tablename__: set(session.exec(select(model.id)).all())
        for model in (Certification, Category, Question, QuestionVersion, AnswerOption)
    }


@pytest.mark.parametrize("exam_status", ["draft", "unpublished"])
def test_admin_deletes_only_unused_configuration(environment, exam_status):
    client, session = environment
    admin = _user(session)
    headers = _headers(admin)
    exam, sibling, _, _ = _seed(session, admin, exam_status=exam_status)
    exam_id, sibling_id = exam.id, sibling.id
    before = _snapshot_ids(session)
    response = client.delete(f"{ADMIN}/{exam_id}", headers=headers)
    assert response.status_code == 204, response.text
    assert response.content == b""
    assert session.get(PracticeExam, exam_id) is None
    assert session.get(PracticeExam, sibling_id) is not None
    assert _snapshot_ids(session) == before
    listing = client.get(ADMIN, headers=headers)
    assert listing.status_code == 200
    assert {item["id"] for item in listing.json()["items"]} == {str(sibling_id)}
    assert client.get(f"{ADMIN}/{exam_id}", headers=headers).status_code == 404
    assert client.delete(f"{ADMIN}/{exam_id}", headers=headers).status_code == 404


def test_published_exam_must_be_unpublished_first(environment):
    client, session = environment
    admin = _user(session)
    headers = _headers(admin)
    exam, _, _, _ = _seed(session, admin, exam_status="published")
    exam_id = exam.id
    response = client.delete(f"{ADMIN}/{exam_id}", headers=headers)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "PRACTICE_EXAM_PUBLISHED"
    assert session.get(PracticeExam, exam_id).status == "published"
    unpublish = client.patch(
        f"{ADMIN}/{exam_id}/publication", headers=headers, json={"is_published": False}
    )
    assert unpublish.status_code == 200, unpublish.text
    assert unpublish.json()["status"] == "unpublished"
    assert client.delete(f"{ADMIN}/{exam_id}", headers=headers).status_code == 204


@pytest.mark.parametrize("attempt_status", ["in_progress", "submitted"])
def test_linked_attempt_protects_exam_and_history(environment, attempt_status):
    client, session = environment
    admin = _user(session)
    learner = _user(session, "learner")
    exam, _, question, version = _seed(session, admin, exam_status="unpublished")
    exam_id = exam.id
    attempt = ExamAttempt(
        user_id=learner.id,
        certification_id=exam.certification_id,
        practice_exam_id=exam_id,
        status=attempt_status,
        question_count=1,
        current_position=1,
        passing_threshold_pct=70,
        feedback_mode="deferred",
        submitted_at=datetime.now(UTC) if attempt_status == "submitted" else None,
    )
    session.add(attempt)
    session.flush()
    attempt_id = attempt.id
    pinned = ExamAttemptQuestion(
        attempt_id=attempt_id,
        question_id=question.id,
        question_version_id=version.id,
        position=1,
        flagged_for_review=True,
    )
    session.add(pinned)
    if attempt_status == "submitted":
        session.add(
            ExamQuestionGrade(
                attempt_id=attempt_id,
                question_id=question.id,
                question_version_id=version.id,
                outcome="correct",
                points_earned=1,
            )
        )
        session.add(
            ExamResult(
                attempt_id=attempt_id,
                points_earned=1,
                points_possible=1,
                score_pct=100,
                threshold_pct=70,
                passed=True,
            )
        )
    session.commit()
    pinned_id = pinned.id
    response = client.delete(f"{ADMIN}/{exam_id}", headers=_headers(admin))
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "PRACTICE_EXAM_HAS_ATTEMPTS"
    assert session.get(PracticeExam, exam_id).status == "unpublished"
    saved = session.get(ExamAttempt, attempt_id)
    assert saved.status == attempt_status
    assert saved.practice_exam_id == exam_id
    assert saved.question_count == 1
    assert session.get(ExamAttemptQuestion, pinned_id).flagged_for_review is True
    results = session.exec(
        select(ExamResult).where(ExamResult.attempt_id == attempt_id)
    ).all()
    grades = session.exec(
        select(ExamQuestionGrade).where(ExamQuestionGrade.attempt_id == attempt_id)
    ).all()
    if attempt_status == "submitted":
        assert len(results) == len(grades) == 1
        assert results[0].score_pct == 100
        assert grades[0].outcome == "correct"
    else:
        assert results == grades == []


@pytest.mark.parametrize("role", ["learner", "contributor"])
def test_non_admin_cannot_delete(environment, role):
    client, session = environment
    admin = _user(session)
    unauthorized = _user(session, role)
    exam, _, _, _ = _seed(session, admin)
    exam_id = exam.id
    response = client.delete(f"{ADMIN}/{exam_id}", headers=_headers(unauthorized))
    assert response.status_code == 403
    assert session.get(PracticeExam, exam_id) is not None


def test_delete_requires_authentication(environment):
    client, session = environment
    admin = _user(session)
    exam, _, _, _ = _seed(session, admin)
    exam_id = exam.id
    assert client.delete(f"{ADMIN}/{exam_id}").status_code == 401
    assert session.get(PracticeExam, exam_id) is not None


def test_unknown_exam_returns_not_found(environment):
    client, session = environment
    admin = _user(session)
    response = client.delete(f"{ADMIN}/{uuid4()}", headers=_headers(admin))
    assert response.status_code == 404
