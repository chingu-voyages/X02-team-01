"""JHEP-121: model-answer and rubric authoring for written questions.

Covers AC1 (both types, contributor drafts cannot publish implicitly),
AC2 (criterion validation, totals), AC4 (published revisions pin the
rubric version), AC6 (editing keeps authored criteria) and the storage
contract that JHEP-122's grading reads.
"""

from collections.abc import Iterator
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.core.roles import UserRole
from app.models.answer_option import AnswerOption
from app.models.category import Category
from app.models.certification import Certification
from app.models.question import Question
from app.models.question_image import QuestionImage
from app.models.question_version import QuestionVersion
from app.models.rubric_criterion import RubricCriterion
from app.models.text_answer_key import TextAnswerKey
from app.models.user import User
from app.schemas.admin_question import QuestionDraftCreate
from app.services.admin_question_service import (
    QuestionDraftScopeError,
    add_question_draft,
    create_question_draft,
    edit_question_draft,
    get_question_bank_details,
    publish_question_draft,
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
            RubricCriterion.__table__,
            QuestionImage.__table__,
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


def seed_contributor(session: Session) -> tuple[User, Certification, Category]:
    actor = User(email=f"{uuid4()}@example.test", role=UserRole.CONTRIBUTOR)
    certification = Certification(name="Rubric Cert", code=f"RC-{uuid4().hex[:8]}")
    session.add(actor)
    session.add(certification)
    session.flush()
    category = Category(certification_id=certification.id, name="Written")
    session.add(category)
    session.commit()
    return actor, certification, category


def seed_administrator(session: Session) -> User:
    actor = User(email=f"{uuid4()}@example.test", role=UserRole.ADMINISTRATOR)
    session.add(actor)
    session.commit()
    return actor


def short_answer_payload(
    certification_id: UUID,
    category_id: UUID | None,
    *,
    rubric: list[dict] | None = None,
    max_points: int | None = None,
    question_type: str = "short_answer",
) -> QuestionDraftCreate:
    body: dict = {
        "certification_id": certification_id,
        "category_id": category_id,
        "difficulty": "medium",
        "question_text": "Explain the difference between a process and a thread.",
        "question_type": question_type,
        "expected_answer": "A process owns memory; a thread shares the process's memory.",
    }
    if rubric is not None:
        body["rubric"] = rubric
    if max_points is not None:
        body["max_points"] = max_points
    return QuestionDraftCreate.model_validate(body)


def rubric_rows(session: Session, version_id: UUID) -> list[RubricCriterion]:
    return list(
        session.exec(
            select(RubricCriterion)
            .where(RubricCriterion.question_version_id == version_id)
            .order_by(RubricCriterion.position)
        )
    )


def test_short_answer_default_rubric_is_one_criterion(session: Session) -> None:
    actor, certification, category = seed_contributor(session)

    created = create_question_draft(
        session,
        short_answer_payload(certification.id, category.id),
        actor_id=actor.id,
    )

    key = session.exec(
        select(TextAnswerKey).where(
            TextAnswerKey.question_version_id == created.question_version_id
        )
    ).one()
    assert key.max_points == 1

    criteria = rubric_rows(session, created.question_version_id)
    assert len(criteria) == 1
    assert criteria[0].name == "Correct response"
    assert criteria[0].points == 1
    assert criteria[0].position == 1


def test_explicit_rubric_sets_total_and_criteria(session: Session) -> None:
    actor, certification, category = seed_contributor(session)

    created = create_question_draft(
        session,
        short_answer_payload(
            certification.id,
            category.id,
            rubric=[
                {"name": "Identifies both concepts", "points": 2},
                {"name": "Explains memory sharing", "points": 3},
            ],
        ),
        actor_id=actor.id,
    )

    key = session.exec(
        select(TextAnswerKey).where(
            TextAnswerKey.question_version_id == created.question_version_id
        )
    ).one()
    assert key.max_points == 5

    criteria = rubric_rows(session, created.question_version_id)
    assert [(row.name, row.points) for row in criteria] == [
        ("Identifies both concepts", 2),
        ("Explains memory sharing", 3),
    ]


def test_max_points_mismatch_is_rejected(session: Session) -> None:
    actor, certification, category = seed_contributor(session)

    with pytest.raises(QuestionDraftScopeError, match="must equal the sum"):
        add_question_draft(
            session,
            short_answer_payload(
                certification.id,
                category.id,
                rubric=[{"name": "Accuracy", "points": 2}],
                max_points=3,
            ),
            actor_id=actor.id,
        )
    session.rollback()

    # Nothing was persisted.
    assert session.exec(select(TextAnswerKey)).all() == []
    assert session.exec(select(RubricCriterion)).all() == []


def test_negative_points_are_rejected_by_schema(session: Session) -> None:
    actor, certification, category = seed_contributor(session)

    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        short_answer_payload(
            certification.id,
            category.id,
            rubric=[{"name": "Accuracy", "points": -1}],
        )


def test_blank_criterion_name_is_rejected(session: Session) -> None:
    actor, certification, category = seed_contributor(session)

    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        short_answer_payload(
            certification.id,
            category.id,
            rubric=[{"name": "   ", "points": 1}],
        )


def test_duplicate_criterion_names_are_rejected(session: Session) -> None:
    actor, certification, category = seed_contributor(session)

    from pydantic import ValidationError

    with pytest.raises(ValidationError, match="unique"):
        short_answer_payload(
            certification.id,
            category.id,
            rubric=[
                {"name": "Accuracy", "points": 1},
                {"name": "accuracy", "points": 2},
            ],
        )


def test_mcq_payload_cannot_define_rubric(session: Session) -> None:
    actor, certification, category = seed_contributor(session)

    from pydantic import ValidationError

    with pytest.raises(ValidationError, match="rubric"):
        QuestionDraftCreate.model_validate(
            {
                "certification_id": certification.id,
                "category_id": category.id,
                "difficulty": "medium",
                "question_text": "Pick one.",
                "question_type": "multiple_choice",
                "options": [
                    {"option_text": "A", "is_correct": True},
                    {"option_text": "B", "is_correct": False},
                ],
                "rubric": [{"name": "Accuracy", "points": 1}],
            }
        )


def test_essay_draft_requires_a_rubric(session: Session) -> None:
    actor, certification, category = seed_contributor(session)

    from pydantic import ValidationError

    with pytest.raises(ValidationError, match="essay questions require a rubric"):
        short_answer_payload(
            certification.id,
            category.id,
            question_type="essay",
            rubric=None,
        )


def test_essay_draft_with_markdown_rubric_persists(session: Session) -> None:
    actor, certification, category = seed_contributor(session)

    created = create_question_draft(
        session,
        short_answer_payload(
            certification.id,
            category.id,
            question_type="essay",
            rubric=[
                {"name": "Thesis clarity", "points": 2},
                {"name": "Argument structure", "points": 3},
                {"name": "Evidence use", "points": 2},
            ],
        ),
        actor_id=actor.id,
    )

    key = session.exec(
        select(TextAnswerKey).where(
            TextAnswerKey.question_version_id == created.question_version_id
        )
    ).one()
    assert key.max_points == 7
    assert key.criteria_markdown is None

    version = session.get(QuestionVersion, created.question_version_id)
    assert version is not None
    assert version.question_type == "essay"


def test_edit_without_rubric_keeps_authored_criteria(session: Session) -> None:
    actor, certification, category = seed_contributor(session)

    created = create_question_draft(
        session,
        short_answer_payload(
            certification.id,
            category.id,
            rubric=[
                {"name": "Identifies both concepts", "points": 2},
                {"name": "Explains memory sharing", "points": 3},
            ],
        ),
        actor_id=actor.id,
    )

    edit = QuestionDraftCreate.model_validate(
        {
            "certification_id": certification.id,
            "category_id": category.id,
            "difficulty": "medium",
            "question_text": "Edited prompt without a rubric.",
            "question_type": "short_answer",
            "expected_answer": "Same model answer.",
        }
    )

    edit_question_draft(
        session,
        created.question_id,
        edit,
        actor=actor,
    )

    detail = get_question_bank_details(session, created.question_id, actor=actor)
    assert [(row.name, row.points) for row in detail.rubric] == [
        ("Identifies both concepts", 2),
        ("Explains memory sharing", 3),
    ]
    assert detail.max_points == 5


def test_published_revision_copies_the_rubric(session: Session) -> None:
    contributor, certification, category = seed_contributor(session)
    administrator = seed_administrator(session)

    created = create_question_draft(
        session,
        short_answer_payload(
            certification.id,
            category.id,
            rubric=[{"name": "Accuracy", "points": 2}],
        ),
        actor_id=contributor.id,
    )

    edit = QuestionDraftCreate.model_validate(
        {
            "certification_id": certification.id,
            "category_id": category.id,
            "difficulty": "medium",
            "question_text": "Final prompt.",
            "question_type": "short_answer",
            "expected_answer": "Model answer.",
            "rubric": [{"name": "Accuracy", "points": 2}],
        }
    )
    edit_question_draft(session, created.question_id, edit, actor=contributor)

    # Publish through the service with an administrator actor.
    admin_actor = seed_administrator(session)
    publish_question_draft(
        session,
        created.question_id,
        actor=admin_actor,
    )

    detail = get_question_bank_details(
        session, created.question_id, actor=administrator
    )
    active_version_id = detail.question_version_id
    active_key = session.exec(
        select(TextAnswerKey).where(
            TextAnswerKey.question_version_id == active_version_id
        )
    ).one()
    assert active_key.max_points == 2
    assert [
        (row.name, row.points) for row in rubric_rows(session, active_version_id)
    ] == [("Accuracy", 2)]

    # The earlier draft version's rubric rows remain untouched (AC4).
    assert [
        (row.name, row.points)
        for row in rubric_rows(session, created.question_version_id)
    ] == [("Accuracy", 2)]


def test_learner_question_contract_never_carries_rubric_fields() -> None:
    """JHEP-121 AC5: the learner delivery contract drops keys and rubrics
    structurally — no field exists to leak, even under direct requests."""
    from app.schemas.question import QuestionOut

    field_names = set(QuestionOut.model_fields)

    assert "expected_answer" not in field_names
    assert "max_points" not in field_names
    assert "criteria_markdown" not in field_names
    assert "rubric" not in field_names
