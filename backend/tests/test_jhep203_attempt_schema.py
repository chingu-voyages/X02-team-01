"""JHEP-203: PostgreSQL constraints for independent published exam attempts."""

import os
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, SQLModel

from app import models  # noqa: F401
from app.db.session import engine
from app.models import Category, Certification, ExamAttempt, PracticeExam, User


@pytest.fixture
def postgres_session():
    if os.getenv("RUN_DB_INTEGRATION") != "1":
        pytest.skip("Set RUN_DB_INTEGRATION=1 to test local PostgreSQL")
    if engine.url.get_backend_name() != "postgresql":
        pytest.fail("These integration tests require PostgreSQL")
    if engine.url.host not in ("localhost", "127.0.0.1", None):
        pytest.fail("Refusing to run integration tests on a remote host")
    if not engine.url.database or "prod" in engine.url.database.lower():
        pytest.fail("Refusing to run against a production-looking database")

    schema = f"jhep203_attempts_{uuid4().hex[:12]}"
    with engine.connect() as connection:
        outer = connection.begin()
        try:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
            scoped = connection.execution_options(schema_translate_map={None: schema})
            SQLModel.metadata.create_all(scoped)
            with Session(
                bind=scoped, join_transaction_mode="create_savepoint"
            ) as session:
                yield session
        finally:
            outer.rollback()


def _seed(session):
    learners = [
        User(email=f"learner-{uuid4().hex}@example.test", role="learner")
        for _ in range(2)
    ]
    cert = Certification(
        name="Computer Science",
        code=f"CS-{uuid4().hex[:10]}",
        passing_threshold_pct=70,
        feedback_mode="immediate",
        is_published=True,
    )
    session.add_all([*learners, cert])
    session.flush()
    category = Category(
        certification_id=cert.id,
        name="Programming Fundamentals",
        is_published=True,
    )
    session.add(category)
    session.flush()
    exams = [
        PracticeExam(
            certification_id=cert.id,
            category_id=category.id,
            name=name,
            status="published",
            question_count=20,
        )
        for name in ("Data", "Programming")
    ]
    session.add_all(exams)
    session.flush()
    return learners, cert, exams


def _attempt(session, learner_id, cert_id, practice_exam_id=None):
    attempt = ExamAttempt(
        user_id=learner_id,
        certification_id=cert_id,
        practice_exam_id=practice_exam_id,
        question_count=20,
    )
    session.add(attempt)
    session.flush()
    return attempt


def test_active_attempts_are_unique_per_learner_and_practice_exam(postgres_session):
    session = postgres_session
    (learner, another_learner), cert, (data, programming) = _seed(session)

    first = _attempt(session, learner.id, cert.id, data.id)
    second = _attempt(session, learner.id, cert.id, programming.id)
    other = _attempt(session, another_learner.id, cert.id, data.id)
    assert len({first.id, second.id, other.id}) == 3

    # The same learner cannot create a second active Data attempt.
    with pytest.raises(IntegrityError), session.begin_nested():
        _attempt(session, learner.id, cert.id, data.id)

    # Submission makes a new attempt possible without losing the old one.
    first.status = "submitted"
    first.submitted_at = datetime.now(UTC)
    session.add(first)
    session.flush()
    retake = _attempt(session, learner.id, cert.id, data.id)
    assert retake.id != first.id
    assert second.status == "in_progress"
    assert other.status == "in_progress"


def test_legacy_attempts_remain_unlinked_and_do_not_block_new_exams(postgres_session):
    session = postgres_session
    (learner, _), cert, (data, _) = _seed(session)
    legacy = _attempt(session, learner.id, cert.id)
    current = _attempt(session, learner.id, cert.id, data.id)
    assert legacy.practice_exam_id is None
    assert current.practice_exam_id == data.id


def test_attempt_cannot_reference_unknown_practice_exam(postgres_session):
    session = postgres_session
    (learner, _), cert, _ = _seed(session)
    with pytest.raises(IntegrityError), session.begin_nested():
        _attempt(session, learner.id, cert.id, uuid4())
