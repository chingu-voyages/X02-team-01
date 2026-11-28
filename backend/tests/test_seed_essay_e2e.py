"""Fixture safety checks and opt-in PostgreSQL catalog verification."""

import os
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url

from scripts.seed_essay_e2e import (
    create_fixture_rows,
    validate_mode,
    validate_seed_target,
)


@pytest.mark.parametrize("host", ["localhost", "127.0.0.1", "[::1]"])
def test_seed_allows_explicit_local_postgresql(host):
    validate_seed_target(make_url(f"postgresql://test:test@{host}/jhep_qa"))


@pytest.mark.parametrize(
    "url",
    [
        "sqlite://",
        "mysql://test:test@localhost/test",
        "postgresql://test:test@db.example.test/jhep_qa",
        "postgresql://test:test@192.168.1.2/jhep_qa",
        "postgresql://test:test@localhost/production",
        "postgresql://test:test@localhost/JHEP_PROD",
        "postgresql://test:test@localhost/",
        "postgresql:///jhep_qa",
        "postgresql://test:test@localhost/jhep_qa?host=remote.example.test",
        "postgresql://test:test@localhost/jhep_qa?hostaddr=10.0.0.1",
    ],
)
def test_seed_rejects_unsafe_targets(url):
    with pytest.raises(RuntimeError):
        validate_seed_target(make_url(url))


@pytest.mark.parametrize("mode", ["immediate", "deferred"])
def test_seed_accepts_supported_feedback_modes(mode):
    validate_mode(mode)


@pytest.mark.parametrize("mode", ["", "IMMEDIATE", "automatic", "unknown"])
def test_seed_rejects_unknown_modes(mode):
    with pytest.raises(ValueError):
        validate_mode(mode)


@pytest.fixture
def essay_seed_session():
    if os.getenv("RUN_DB_INTEGRATION") != "1":
        pytest.skip("PostgreSQL integration tests are opt-in")
    from sqlmodel import Session, SQLModel

    from app import models  # noqa: F401
    from app.db.session import engine

    validate_seed_target(engine.url)
    schema = f"jhep120_seed_{uuid4().hex}"
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


@pytest.mark.parametrize("mode", ["immediate", "deferred"])
def test_seed_creates_real_isolated_eligible_catalog(essay_seed_session, mode):
    from sqlmodel import select

    from app.models import ExamAttempt, QuestionVersion, User
    from app.repositories.sqlmodel_repository import SQLModelQuestionRepository
    from app.services.exam_service import ExamService

    session = essay_seed_session
    first = create_fixture_rows(session, mode)
    second = create_fixture_rows(session, mode)
    session.commit()
    assert first["run_id"] != second["run_id"]
    assert first["email"] != second["email"]
    assert first["practice_exam_id"] != second["practice_exam_id"]
    assert len(session.exec(select(User)).all()) == 8
    assert len(session.exec(select(QuestionVersion)).all()) == 8
    assert session.exec(select(ExamAttempt)).all() == []

    for fixture in (first, second):
        assert fixture["question_count"] == 4
        types = [question["question_type"] for question in fixture["questions"]]
        assert sorted(types) == ["essay", "essay", "multiple_choice", "short_answer"]
        reviewer = session.exec(
            select(User).where(User.email == fixture["reviewer_email"])
        ).one()
        assert reviewer.role == "contributor"
        assert reviewer.grade_essays is True
        assert reviewer.grade_short_answers is False
        learner = session.exec(select(User).where(User.email == fixture["email"])).one()
        selected = SQLModelQuestionRepository(session).select_random_eligible(
            certification_id=UUID(fixture["certification_id"]),
            question_count=4,
            category_id=UUID(fixture["category_id"]),
        )
        assert {str(row.question_version_id) for row in selected} == {
            item["version_id"] for item in fixture["questions"]
        }
        created = ExamService(session).create_exam(
            learner_id=learner.id,
            certification_id=UUID(fixture["certification_id"]),
            category_id=UUID(fixture["category_id"]),
            practice_exam_id=UUID(fixture["practice_exam_id"]),
            question_count=4,
        )
        assert created.question_count == 4
    assert len(session.exec(select(ExamAttempt)).all()) == 2
