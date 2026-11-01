"""PostgreSQL test for saved-order retrieval and fixed query count."""

import os
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import event, text
from sqlmodel import Session, SQLModel

from app import models  # noqa: F401
from app.models import AnswerOption, Certification, Question, QuestionVersion, User
from app.services.exam_service import ExamAttemptNotFoundError, ExamService


@pytest.fixture
def pg_session():
    if os.getenv("RUN_DB_INTEGRATION") != "1":
        pytest.skip("PostgreSQL integration tests are opt-in")
    from app.db.session import engine

    if engine.url.get_backend_name() != "postgresql" or engine.url.host not in {
        "localhost",
        "127.0.0.1",
        None,
    }:
        pytest.fail("Tests must run against local PostgreSQL")

    schema = f"jhep29_resume_{uuid4().hex[:12]}"
    with engine.connect() as connection:
        outer = connection.begin()
        try:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
            scoped = connection.execution_options(schema_translate_map={None: schema})
            SQLModel.metadata.create_all(scoped)
            with Session(
                bind=scoped, join_transaction_mode="create_savepoint"
            ) as session:
                yield session, scoped
        finally:
            outer.rollback()


def test_saved_order_access_control_and_batched_retrieval(pg_session):
    session, connection = pg_session
    user = User(email=f"owner-{uuid4().hex}@example.test")
    other = User(email=f"other-{uuid4().hex}@example.test")
    cert = Certification(
        name="Retrieve", code=uuid4().hex[:12], passing_threshold_pct=70
    )
    session.add_all([user, other, cert])
    session.flush()

    for i in range(12):
        q = Question(certification_id=cert.id, created_by_id=user.id, difficulty="easy")
        session.add(q)
        session.flush()
        v = QuestionVersion(
            question_id=q.id,
            version_number=1,
            question_text=f"Q{i} — français ∑",
            question_type="multiple_choice",
            review_status="approved",
            publication_status="active",
            submitted_by_id=user.id,
            reviewed_by_id=user.id,
            reviewed_at=datetime.now(UTC),
        )
        session.add(v)
        session.flush()
        session.add_all(
            [
                AnswerOption(
                    question_version_id=v.id,
                    position=j,
                    option_text=f"Answer {j}",
                    is_correct=j == 1,
                )
                for j in (1, 2)
            ]
        )
        session.flush()

    service = ExamService(session)
    created = service.create_exam(
        learner_id=user.id, certification_id=cert.id, question_count=12
    )
    with pytest.raises(ExamAttemptNotFoundError):
        service.get_owned_attempt(attempt_id=created.attempt_id, learner_id=other.id)
    attempt = service.get_owned_attempt(
        attempt_id=created.attempt_id, learner_id=user.id
    )
    assert attempt.current_position == 1

    statements = []

    def track(_conn, _cursor, statement, _params, _context, _executemany):
        if statement.lstrip().lower().startswith("select"):
            statements.append(statement)

    event.listen(connection, "before_cursor_execute", track)
    try:
        first = service.get_exam_questions(attempt.id)
        first_queries = len(statements)
        statements.clear()
        second = service.get_exam_questions(attempt.id)
        second_queries = len(statements)
    finally:
        event.remove(connection, "before_cursor_execute", track)

    assert first_queries == second_queries == 3
    assert len(first) == len(second) == 12
    assert [(q.id, q.position) for q in first] == [(q.id, q.position) for q in second]
