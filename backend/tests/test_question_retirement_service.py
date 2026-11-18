from collections.abc import Iterator
from datetime import UTC, datetime
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.core.roles import UserRole
from app.models.answer_option import AnswerOption
from app.models.category import Category
from app.models.certification import Certification
from app.models.exam_attempt import ExamAttempt
from app.models.exam_attempt_question import ExamAttemptQuestion
from app.models.question import Question
from app.models.question_version import QuestionVersion
from app.models.user import User
from app.repositories.question_eligibility import eligible_exam_questions_statement
from app.schemas.admin_question import QuestionDraftCreate
from app.services.admin_question_service import create_question_draft
from app.services.question_retirement_service import (
    QuestionNotRetirableError,
    QuestionRetirementNotFoundError,
    retire_question,
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
            ExamAttempt.__table__,
            ExamAttemptQuestion.__table__,
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


def create_user(session: Session, role: UserRole) -> User:
    user = User(
        email=f"{uuid4()}@example.test",
        role=role,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def seed_scope(session: Session) -> tuple[Certification, Category]:
    certification = Certification(
        name="Example Certification",
        code=f"CERT-{uuid4().hex[:8]}",
    )
    session.add(certification)
    session.flush()

    category = Category(
        certification_id=certification.id,
        name="Example Category",
    )
    session.add(category)
    session.commit()
    return certification, category


def create_active_question(
    session: Session,
    *,
    owner: User,
    reviewer: User,
    certification: Certification,
    category: Category,
):
    payload = QuestionDraftCreate.model_validate(
        {
            "certification_id": certification.id,
            "category_id": category.id,
            "difficulty": "medium",
            "question_text": "Published question",
            "question_type": "multiple_choice",
            "explanation": "Published explanation",
            "options": [
                {"option_text": "Correct", "is_correct": True},
                {"option_text": "Incorrect", "is_correct": False},
            ],
        }
    )
    created = create_question_draft(session, payload, actor_id=owner.id)

    reviewer_id = reviewer.id
    version = session.get(QuestionVersion, created.question_version_id)
    assert version is not None
    version.reviewed_by_id = reviewer_id
    version.reviewed_at = datetime.now(UTC)
    version.review_status = "approved"
    version.publication_status = "active"
    session.add(version)
    session.commit()
    return created


def test_retire_active_question_preserves_records_and_answer_configuration(
    session: Session,
):
    administrator = create_user(session, UserRole.ADMINISTRATOR)
    contributor = create_user(session, UserRole.CONTRIBUTOR)
    certification, category = seed_scope(session)
    created = create_active_question(
        session,
        owner=contributor,
        reviewer=administrator,
        certification=certification,
        category=category,
    )

    options_before = session.exec(
        select(AnswerOption).where(
            AnswerOption.question_version_id == created.question_version_id
        )
    ).all()

    result = retire_question(session, created.question_id)

    question = session.get(Question, created.question_id)
    version = session.get(QuestionVersion, created.question_version_id)
    options_after = session.exec(
        select(AnswerOption).where(
            AnswerOption.question_version_id == created.question_version_id
        )
    ).all()

    assert question is not None
    assert version is not None
    assert version.review_status == "approved"
    assert version.publication_status == "retired"
    assert [item.id for item in options_after] == [item.id for item in options_before]
    assert result.question_id == created.question_id
    assert result.retired_version_ids == (created.question_version_id,)
    assert result.already_retired is False


def test_retirement_closes_pending_draft_revision_too(session: Session):
    administrator = create_user(session, UserRole.ADMINISTRATOR)
    contributor = create_user(session, UserRole.CONTRIBUTOR)
    certification, category = seed_scope(session)
    created = create_active_question(
        session,
        owner=contributor,
        reviewer=administrator,
        certification=certification,
        category=category,
    )

    draft_revision = QuestionVersion(
        question_id=created.question_id,
        version_number=2,
        question_text="Pending revision",
        question_type="multiple_choice",
        allows_multiple_answers=False,
        explanation="Not yet approved",
        review_status="pending",
        publication_status="draft",
        is_flagged=False,
        submitted_by_id=administrator.id,
    )
    session.add(draft_revision)
    session.flush()
    session.add_all(
        [
            AnswerOption(
                question_version_id=draft_revision.id,
                option_text="New correct",
                is_correct=True,
                position=1,
            ),
            AnswerOption(
                question_version_id=draft_revision.id,
                option_text="New incorrect",
                is_correct=False,
                position=2,
            ),
        ]
    )
    session.commit()

    result = retire_question(session, created.question_id)

    versions = session.exec(
        select(QuestionVersion)
        .where(QuestionVersion.question_id == created.question_id)
        .order_by(QuestionVersion.version_number)
    ).all()
    assert [version.publication_status for version in versions] == [
        "retired",
        "retired",
    ]
    assert result.retired_version_ids == tuple(version.id for version in versions)


def test_retired_question_is_excluded_from_future_exam_eligibility(session: Session):
    administrator = create_user(session, UserRole.ADMINISTRATOR)
    contributor = create_user(session, UserRole.CONTRIBUTOR)
    certification, category = seed_scope(session)
    created = create_active_question(
        session,
        owner=contributor,
        reviewer=administrator,
        certification=certification,
        category=category,
    )

    before = session.exec(eligible_exam_questions_statement()).all()
    assert any(row.question_id == created.question_id for row in before)

    retire_question(session, created.question_id)

    after = session.exec(eligible_exam_questions_statement()).all()
    assert all(row.question_id != created.question_id for row in after)


def test_historical_attempt_keeps_pinned_version_after_retirement(session: Session):
    administrator = create_user(session, UserRole.ADMINISTRATOR)
    contributor = create_user(session, UserRole.CONTRIBUTOR)
    learner = create_user(session, UserRole.LEARNER)
    certification, category = seed_scope(session)
    created = create_active_question(
        session,
        owner=contributor,
        reviewer=administrator,
        certification=certification,
        category=category,
    )

    attempt = ExamAttempt(
        user_id=learner.id,
        certification_id=certification.id,
        status="submitted",
        question_count=1,
        current_position=1,
        passing_threshold_pct=70,
        feedback_mode="immediate",
        submitted_at=datetime.now(UTC),
    )
    session.add(attempt)
    session.flush()

    attempt_question = ExamAttemptQuestion(
        attempt_id=attempt.id,
        question_id=created.question_id,
        question_version_id=created.question_version_id,
        position=1,
    )
    session.add(attempt_question)
    session.commit()

    retire_question(session, created.question_id)

    stored = session.get(ExamAttemptQuestion, attempt_question.id)
    version = session.get(QuestionVersion, created.question_version_id)
    assert stored is not None
    assert stored.question_id == created.question_id
    assert stored.question_version_id == created.question_version_id
    assert version is not None
    assert version.question_text == "Published question"
    assert version.publication_status == "retired"


def test_retirement_is_idempotent_after_question_is_retired(session: Session):
    administrator = create_user(session, UserRole.ADMINISTRATOR)
    contributor = create_user(session, UserRole.CONTRIBUTOR)
    certification, category = seed_scope(session)
    created = create_active_question(
        session,
        owner=contributor,
        reviewer=administrator,
        certification=certification,
        category=category,
    )

    first = retire_question(session, created.question_id)
    second = retire_question(session, created.question_id)

    assert first.already_retired is False
    assert second.already_retired is True
    assert second.retired_version_ids == first.retired_version_ids


def test_draft_only_question_cannot_be_retired(session: Session):
    contributor = create_user(session, UserRole.CONTRIBUTOR)
    certification, category = seed_scope(session)
    payload = QuestionDraftCreate.model_validate(
        {
            "certification_id": certification.id,
            "category_id": category.id,
            "difficulty": "easy",
            "question_text": "Draft only",
            "question_type": "multiple_choice",
            "options": [
                {"option_text": "Correct", "is_correct": True},
                {"option_text": "Incorrect", "is_correct": False},
            ],
        }
    )
    created = create_question_draft(session, payload, actor_id=contributor.id)

    with pytest.raises(
        QuestionNotRetirableError,
        match="Only active published questions can be retired",
    ):
        retire_question(session, created.question_id)

    version = session.get(QuestionVersion, created.question_version_id)
    assert version is not None
    assert version.publication_status == "draft"


def test_missing_question_cannot_be_retired(session: Session):
    with pytest.raises(QuestionRetirementNotFoundError, match="Question not found"):
        retire_question(session, uuid4())

    assert session.exec(select(Question)).all() == []
