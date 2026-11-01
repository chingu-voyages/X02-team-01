"""JHEP-29 PostgreSQL hardening: isolation, persistence, and integrity.

Opt in via RUN_DB_INTEGRATION=1. Use only a disposable LOCAL PostgreSQL DB.
Tests create an isolated schema and roll back their outer transaction.
"""

import os
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, SQLModel, select

from app import models  # noqa: F401
from app.db.session import engine
from app.models import (
    AnswerOption,
    Certification,
    ExamAttempt,
    ExamAttemptQuestion,
    Question,
    QuestionVersion,
    TextAnswerKey,
    User,
)
from app.services.exam_service import ExamService, InsufficientQuestionsError


@pytest.fixture
def postgres_session():
    if os.getenv("RUN_DB_INTEGRATION") != "1":
        pytest.skip("PostgreSQL integration tests are opt-in")
    if engine.url.get_backend_name() != "postgresql":
        pytest.fail("PostgreSQL integration tests require PostgreSQL")
    if engine.url.host not in ("localhost", "127.0.0.1", None):
        pytest.fail("Refusing to run integration tests on a remote PostgreSQL host")

    schema = f"jhep29_hardening_{uuid4().hex[:12]}"
    with engine.connect() as conn:
        outer = conn.begin()
        try:
            conn.execute(text(f'CREATE SCHEMA "{schema}"'))
            scoped = conn.execution_options(schema_translate_map={None: schema})
            SQLModel.metadata.create_all(scoped)
            with Session(
                bind=scoped, join_transaction_mode="create_savepoint"
            ) as session:
                yield session
        finally:
            outer.rollback()


def add_question(
    session: Session,
    learner_id: UUID,
    certification_id: UUID,
    *,
    prompt: str,
    review_status: str = "approved",
    publication_status: str = "active",
    flagged: bool = False,
    question_type: str = "multiple_choice",
) -> tuple[UUID, UUID]:
    question = Question(
        certification_id=certification_id,
        difficulty="easy",
        created_by_id=learner_id,
    )
    session.add(question)
    session.flush()

    reviewed = review_status != "pending"
    version = QuestionVersion(
        question_id=question.id,
        version_number=1,
        question_text=prompt,
        question_type=question_type,
        review_status=review_status,
        publication_status=publication_status,
        is_flagged=flagged,
        explanation="POST-SUBMISSION ONLY — keep out of pre-submission response",
        review_note="INTERNAL REVIEW NOTE — keep private",
        submitted_by_id=learner_id,
        reviewed_by_id=learner_id if reviewed else None,
        reviewed_at=datetime.now(UTC) if reviewed else None,
    )
    session.add(version)
    session.flush()

    if question_type == "multiple_choice":
        session.add_all(
            [
                AnswerOption(
                    question_version_id=version.id,
                    position=1,
                    option_text="A: résumé ✓",
                    is_correct=True,
                ),
                AnswerOption(
                    question_version_id=version.id,
                    position=2,
                    option_text='B: <tag> "other" & é',
                    is_correct=False,
                ),
            ]
        )
    else:
        session.add(
            TextAnswerKey(
                question_version_id=version.id,
                expected_answer="PRIVATE KEY — never deliver before grading",
            )
        )
    session.flush()
    return question.id, version.id


@pytest.fixture
def mixed_bank(postgres_session):
    session = postgres_session
    learner = User(email=f"hardening-{uuid4().hex}@example.com")
    first_cert = Certification(name="Certification A", code=uuid4().hex[:12])
    second_cert = Certification(name="Certification B", code=uuid4().hex[:12])
    session.add_all([learner, first_cert, second_cert])
    session.flush()

    multilingual_long_text = (
        "Français français — العربية 中文 日本語 — ∑ ∫ √ π ≤ ≥ 😃\n"
        + "é(x)² <tag> & 'quotes' \"double\" — " * 1000
    )
    a_eligible = {
        add_question(
            session,
            learner.id,
            first_cert.id,
            prompt=multilingual_long_text,
        )[1],
        add_question(
            session,
            learner.id,
            first_cert.id,
            prompt="Which sprint event takes place?",
        )[1],
        add_question(
            session,
            learner.id,
            first_cert.id,
            prompt="Explain the retrospective in your own words",
            question_type="short_answer",
        )[1],
    }
    a_excluded = {
        add_question(
            session,
            learner.id,
            first_cert.id,
            prompt="Flagged, should not appear",
            flagged=True,
        )[1],
        add_question(
            session,
            learner.id,
            first_cert.id,
            prompt="Draft, should not appear",
            publication_status="draft",
        )[1],
        add_question(
            session,
            learner.id,
            first_cert.id,
            prompt="Retired, should not appear",
            publication_status="retired",
        )[1],
        add_question(
            session,
            learner.id,
            first_cert.id,
            prompt="Pending, should not appear",
            review_status="pending",
            publication_status="draft",
        )[1],
        add_question(
            session,
            learner.id,
            first_cert.id,
            prompt="Rejected, should not appear",
            review_status="rejected",
            publication_status="draft",
        )[1],
    }
    b_eligible = {
        add_question(
            session,
            learner.id,
            second_cert.id,
            prompt="Certification B question 1",
        )[1],
        add_question(
            session,
            learner.id,
            second_cert.id,
            prompt="Certification B question 2",
        )[1],
    }
    return {
        "learner_id": learner.id,
        "first_cert_id": first_cert.id,
        "second_cert_id": second_cert.id,
        "first_eligible": a_eligible,
        "first_excluded": a_excluded,
        "second_eligible": b_eligible,
        "long_text": multilingual_long_text,
    }


def assigned_questions(session: Session, attempt_id: UUID):
    return session.exec(
        select(ExamAttemptQuestion)
        .where(ExamAttemptQuestion.attempt_id == attempt_id)
        .order_by(ExamAttemptQuestion.position)
    ).all()


def test_exam_contains_only_approved_questions_from_requested_certification(
    postgres_session, mixed_bank
):
    session = postgres_session
    created = ExamService(session).create_exam(
        learner_id=mixed_bank["learner_id"],
        certification_id=mixed_bank["first_cert_id"],
        question_count=3,
    )
    attempt = session.get(ExamAttempt, created.attempt_id)
    assert attempt is not None
    assert attempt.user_id == mixed_bank["learner_id"]
    assert attempt.certification_id == mixed_bank["first_cert_id"]
    assert attempt.status == "in_progress"
    assert attempt.question_count == 3
    assert attempt.current_position == 1

    assigned = assigned_questions(session, created.attempt_id)
    assert [item.position for item in assigned] == [1, 2, 3]
    assert {item.question_version_id for item in assigned} == mixed_bank[
        "first_eligible"
    ]
    assert {item.question_version_id for item in assigned}.isdisjoint(
        mixed_bank["first_excluded"] | mixed_bank["second_eligible"]
    )
    assert len({item.question_id for item in assigned}) == 3


def test_separate_exam_attempts_remain_independent_and_order_is_stable(
    postgres_session, mixed_bank
):
    session = postgres_session
    service = ExamService(session)
    first = service.create_exam(
        learner_id=mixed_bank["learner_id"],
        certification_id=mixed_bank["first_cert_id"],
        question_count=3,
    )
    saved_order = [
        (item.question_version_id, item.position)
        for item in assigned_questions(session, first.attempt_id)
    ]
    first_delivery = [
        (item.id, item.position)
        for item in service.get_exam_questions(first.attempt_id)
    ]

    second = service.create_exam(
        learner_id=mixed_bank["learner_id"],
        certification_id=mixed_bank["first_cert_id"],
        question_count=3,
    )
    assert first.attempt_id != second.attempt_id
    assert len(assigned_questions(session, second.attempt_id)) == 3
    assert saved_order == [
        (item.question_version_id, item.position)
        for item in assigned_questions(session, first.attempt_id)
    ]
    assert first_delivery == [
        (item.id, item.position)
        for item in service.get_exam_questions(first.attempt_id)
    ]
    # Do NOT assert independent random attempts have different ordering: flaky.


def test_question_content_unicode_long_text_and_keys_are_safe(
    postgres_session, mixed_bank
):
    service = ExamService(postgres_session)
    created = service.create_exam(
        learner_id=mixed_bank["learner_id"],
        certification_id=mixed_bank["first_cert_id"],
        question_count=3,
    )
    delivered = service.get_exam_questions(created.attempt_id)
    assert len(delivered) == 3
    assert [question.position for question in delivered] == [1, 2, 3]
    assert mixed_bank["long_text"] in [question.question_text for question in delivered]
    assert any(question.question_type == "short_answer" for question in delivered)
    for question in delivered:
        assert set(vars(question)) == {
            "id",
            "position",
            "question_text",
            "question_type",
            "allows_multiple_answers",
            "difficulty",
            "options",
            "images",
        }
        for option in question.options:
            assert set(vars(option)) == {"id", "position", "option_text"}
        if question.question_type == "short_answer":
            assert question.options == []


def test_other_certification_only_receives_its_questions(postgres_session, mixed_bank):
    created = ExamService(postgres_session).create_exam(
        learner_id=mixed_bank["learner_id"],
        certification_id=mixed_bank["second_cert_id"],
        question_count=2,
    )
    assert {
        item.question_version_id
        for item in assigned_questions(postgres_session, created.attempt_id)
    } == mixed_bank["second_eligible"]


def test_insufficient_pool_creates_no_partial_attempt(postgres_session, mixed_bank):
    session = postgres_session
    before_count = len(session.exec(select(ExamAttempt)).all())
    with pytest.raises(InsufficientQuestionsError) as exc:
        ExamService(session).create_exam(
            learner_id=mixed_bank["learner_id"],
            certification_id=mixed_bank["first_cert_id"],
            question_count=4,
        )
    assert (exc.value.requested, exc.value.available) == (4, 3)
    assert len(session.exec(select(ExamAttempt)).all()) == before_count
    assert session.exec(select(ExamAttemptQuestion)).all() == []


def test_database_rejects_duplicate_question_assignment(postgres_session, mixed_bank):
    session = postgres_session
    created = ExamService(session).create_exam(
        learner_id=mixed_bank["learner_id"],
        certification_id=mixed_bank["first_cert_id"],
        question_count=1,
    )
    original = assigned_questions(session, created.attempt_id)[0]
    session.add(
        ExamAttemptQuestion(
            attempt_id=created.attempt_id,
            question_id=original.question_id,
            question_version_id=original.question_version_id,
            position=2,
        )
    )
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()


def test_database_rejects_duplicate_position_assignment(postgres_session, mixed_bank):
    session = postgres_session
    created = ExamService(session).create_exam(
        learner_id=mixed_bank["learner_id"],
        certification_id=mixed_bank["first_cert_id"],
        question_count=1,
    )
    original = assigned_questions(session, created.attempt_id)[0]
    remaining_version = next(
        version_id
        for version_id in mixed_bank["first_eligible"]
        if version_id != original.question_version_id
    )
    second_version = session.get(QuestionVersion, remaining_version)
    assert second_version is not None
    session.add(
        ExamAttemptQuestion(
            attempt_id=created.attempt_id,
            question_id=second_version.question_id,
            question_version_id=remaining_version,
            position=1,
        )
    )
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()
