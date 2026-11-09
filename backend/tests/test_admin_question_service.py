from collections.abc import Iterator
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.core.roles import UserRole
from app.models.answer_option import AnswerOption
from app.models.category import Category
from app.models.certification import Certification
from app.models.question import Question
from app.models.question_version import QuestionVersion
from app.models.text_answer_key import TextAnswerKey
from app.models.user import User
from app.schemas.admin_question import QuestionDraftCreate
from app.services.admin_question_service import (
    QuestionDraftScopeError,
    create_question_draft,
)


@pytest.fixture
def engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @sa.event.listens_for(engine, "connect")
    def enable_foreign_keys(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    SQLModel.metadata.create_all(
        engine,
        tables=[
            User.__table__,
            Certification.__table__,
            Category.__table__,
            Question.__table__,
            QuestionVersion.__table__,
            AnswerOption.__table__,
            TextAnswerKey.__table__,
        ],
    )

    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture
def session(engine) -> Iterator[Session]:
    with Session(engine) as database_session:
        yield database_session


def seed_scope(
    session: Session,
) -> tuple[User, Certification, Category]:
    actor = User(
        email=f"{uuid4()}@example.test",
        role=UserRole.CONTRIBUTOR,
    )

    certification = Certification(
        name="Example Certification",
        code=f"CERT-{uuid4().hex[:8]}",
    )

    session.add(actor)
    session.add(certification)

    # Persist parent rows before creating the category foreign key.
    session.flush()

    category = Category(
        certification_id=certification.id,
        name="Example Category",
    )

    session.add(category)
    session.commit()

    return actor, certification, category


def multiple_choice_payload(
    certification_id: UUID,
    category_id: UUID | None,
) -> QuestionDraftCreate:
    return QuestionDraftCreate.model_validate(
        {
            "certification_id": certification_id,
            "category_id": category_id,
            "difficulty": "medium",
            "question_text": "Which statement is correct?",
            "question_type": "multiple_choice",
            "allows_multiple_answers": False,
            "explanation": "The first option is correct.",
            "options": [
                {
                    "option_text": "Correct",
                    "is_correct": True,
                },
                {
                    "option_text": "Incorrect",
                    "is_correct": False,
                },
            ],
        }
    )


def test_create_multiple_choice_draft_persists_full_graph(
    session: Session,
):
    actor, certification, category = seed_scope(session)

    payload = multiple_choice_payload(
        certification.id,
        category.id,
    )

    created = create_question_draft(
        session,
        payload,
        actor_id=actor.id,
    )

    question = session.get(
        Question,
        created.question_id,
    )

    version = session.get(
        QuestionVersion,
        created.question_version_id,
    )

    options = session.exec(
        select(AnswerOption)
        .where(AnswerOption.question_version_id == created.question_version_id)
        .order_by(AnswerOption.position)
    ).all()

    assert question is not None
    assert question.certification_id == certification.id
    assert question.category_id == category.id
    assert question.difficulty == "medium"
    assert question.created_by_id == actor.id

    assert version is not None
    assert version.question_id == question.id
    assert version.version_number == 1
    assert version.question_text == "Which statement is correct?"
    assert version.question_type == "multiple_choice"
    assert version.allows_multiple_answers is False
    assert version.explanation == "The first option is correct."
    assert version.review_status == "pending"
    assert version.publication_status == "draft"
    assert version.is_flagged is False
    assert version.submitted_by_id == actor.id

    assert [
        (
            item.position,
            item.option_text,
            item.is_correct,
        )
        for item in options
    ] == [
        (1, "Correct", True),
        (2, "Incorrect", False),
    ]

    assert session.exec(select(TextAnswerKey)).all() == []


def test_create_short_answer_draft_persists_text_key(
    session: Session,
):
    actor, certification, category = seed_scope(session)

    payload = QuestionDraftCreate.model_validate(
        {
            "certification_id": certification.id,
            "category_id": category.id,
            "difficulty": "easy",
            "question_text": "What does MVP stand for?",
            "question_type": "short_answer",
            "expected_answer": "Minimum Viable Product",
            "explanation": "This is the standard expansion.",
        }
    )

    created = create_question_draft(
        session,
        payload,
        actor_id=actor.id,
    )

    answer_key = session.exec(
        select(TextAnswerKey).where(
            TextAnswerKey.question_version_id == created.question_version_id
        )
    ).one()

    assert answer_key.expected_answer == "Minimum Viable Product"

    assert session.exec(select(AnswerOption)).all() == []

    assert created.version_number == 1
    assert created.review_status == "pending"
    assert created.publication_status == "draft"


def test_create_draft_allows_uncategorized_question(
    session: Session,
):
    actor, certification, _category = seed_scope(session)

    payload = multiple_choice_payload(
        certification.id,
        None,
    )

    created = create_question_draft(
        session,
        payload,
        actor_id=actor.id,
    )

    question = session.get(
        Question,
        created.question_id,
    )

    assert question is not None
    assert question.category_id is None


def test_unknown_certification_is_rejected_without_writes(
    session: Session,
):
    actor, _certification, _category = seed_scope(session)

    payload = multiple_choice_payload(
        uuid4(),
        None,
    )

    with pytest.raises(
        QuestionDraftScopeError,
        match="Certification not found",
    ):
        create_question_draft(
            session,
            payload,
            actor_id=actor.id,
        )

    assert session.exec(select(Question)).all() == []

    assert session.exec(select(QuestionVersion)).all() == []


def test_unknown_category_is_rejected_without_writes(
    session: Session,
):
    actor, certification, _category = seed_scope(session)

    payload = multiple_choice_payload(
        certification.id,
        uuid4(),
    )

    with pytest.raises(
        QuestionDraftScopeError,
        match="Category not found",
    ):
        create_question_draft(
            session,
            payload,
            actor_id=actor.id,
        )

    assert session.exec(select(Question)).all() == []

    assert session.exec(select(QuestionVersion)).all() == []


def test_category_must_belong_to_selected_certification(
    session: Session,
):
    actor, certification, _category = seed_scope(session)

    other_certification = Certification(
        name="Other Certification",
        code=f"OTHER-{uuid4().hex[:8]}",
    )

    session.add(other_certification)

    # Persist the certification before creating its category FK.
    session.flush()

    other_category = Category(
        certification_id=other_certification.id,
        name="Other Category",
    )

    session.add(other_category)
    session.commit()

    payload = multiple_choice_payload(
        certification.id,
        other_category.id,
    )

    with pytest.raises(
        QuestionDraftScopeError,
        match=("Category does not belong to the selected certification"),
    ):
        create_question_draft(
            session,
            payload,
            actor_id=actor.id,
        )

    assert session.exec(select(Question)).all() == []

    assert session.exec(select(QuestionVersion)).all() == []


def test_database_failure_rolls_back_entire_draft(
    session: Session,
):
    _actor, certification, category = seed_scope(session)

    payload = multiple_choice_payload(
        certification.id,
        category.id,
    )

    # An invalid actor FK deliberately forces the service to fail.
    # The entire draft transaction must then be rolled back.
    with pytest.raises(IntegrityError):
        create_question_draft(
            session,
            payload,
            actor_id=uuid4(),
        )

    assert session.exec(select(Question)).all() == []

    assert session.exec(select(QuestionVersion)).all() == []

    assert session.exec(select(AnswerOption)).all() == []

    assert session.exec(select(TextAnswerKey)).all() == []
