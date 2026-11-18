"""AC2 and AC6: configuration bounds and malformed bank protection."""

import os
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import text
from sqlmodel import Session, SQLModel, select

from app import models  # noqa: F401
from app.core.config import Settings, settings
from app.models import AnswerOption, Certification, Question, QuestionVersion, User
from app.repositories.sqlmodel_repository import SQLModelQuestionRepository
from app.schemas.exam import ExamCreateRequest
from app.services.exam_service import ExamService, InvalidQuestionCountError


def test_configured_limit_is_between_1_and_100():
    # Test the field definition without constructing a database connection.
    field = Settings.model_fields["max_exam_questions"]
    assert field.default == 100
    assert any(getattr(meta, "ge", None) == 1 for meta in field.metadata)
    assert any(getattr(meta, "le", None) == 100 for meta in field.metadata)


@pytest.mark.parametrize("count", [1, 25, 100])
def test_request_accepts_valid_exam_sizes(count):
    payload = ExamCreateRequest(certification_id=uuid4(), question_count=count)
    assert payload.question_count == count


@pytest.mark.parametrize("count", [0, -2, 101, True, "5", 1.5])
def test_request_rejects_invalid_exam_sizes(count):
    with pytest.raises(ValidationError):
        ExamCreateRequest(certification_id=uuid4(), question_count=count)


def test_service_enforces_deployment_limit_before_database_access(monkeypatch):
    monkeypatch.setattr(settings, "max_exam_questions", 3)
    service = ExamService(object())  # No DB method should be reached.
    with pytest.raises(InvalidQuestionCountError, match="must not exceed 3"):
        service.create_exam(
            learner_id=uuid4(), certification_id=uuid4(), question_count=4
        )


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

    schema = f"jhep29_ac_{uuid4().hex[:12]}"
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


def test_malformed_multiple_choice_question_is_not_selected(pg_session):
    user = User(email=f"qa-{uuid4().hex}@example.test")
    cert = Certification(
        name="Integrity", code=uuid4().hex[:12], passing_threshold_pct=70
    )
    pg_session.add_all([user, cert])
    pg_session.flush()

    def version_for(number: int, correct: tuple[bool, ...], multi: bool = False):
        question = Question(
            certification_id=cert.id, created_by_id=user.id, difficulty="easy"
        )
        pg_session.add(question)
        pg_session.flush()
        version = QuestionVersion(
            question_id=question.id,
            version_number=1,
            question_text=f"Question {number}",
            question_type="multiple_choice",
            allows_multiple_answers=multi,
            review_status="approved",
            publication_status="active",
            submitted_by_id=user.id,
            reviewed_by_id=user.id,
            reviewed_at=datetime.now(UTC),
        )
        pg_session.add(version)
        pg_session.flush()
        pg_session.add_all(
            [
                AnswerOption(
                    question_version_id=version.id,
                    position=i,
                    option_text=f"Choice {i}",
                    is_correct=flag,
                )
                for i, flag in enumerate(correct, start=1)
            ]
        )
        pg_session.flush()
        return version.id

    valid = version_for(1, (True, False))
    version_for(2, ())  # No options.
    version_for(3, (True,))  # Only one option.
    version_for(4, (False, False))  # No right answer.
    version_for(5, (True, True))  # Multi-correct for single-select.
    other_valid = version_for(6, (True, True, False), multi=True)

    picked = SQLModelQuestionRepository(pg_session).select_random_eligible(cert.id, 10)
    assert {p.question_version_id for p in picked} == {valid, other_valid}

    from app.services.exam_service import InsufficientQuestionsError

    before = pg_session.exec(select(models.ExamAttempt)).all()
    with pytest.raises(InsufficientQuestionsError):
        ExamService(pg_session).create_exam(
            learner_id=user.id, certification_id=cert.id, question_count=3
        )
    assert pg_session.exec(select(models.ExamAttempt)).all() == before
