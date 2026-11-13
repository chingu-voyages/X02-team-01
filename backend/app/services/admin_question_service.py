"""Persistence services for administrator/contributor question management."""

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlmodel import Session, select

from app.core.roles import UserRole
from app.models.answer_option import AnswerOption
from app.models.category import Category
from app.models.certification import Certification
from app.models.question import Question
from app.models.question_image import QuestionImage
from app.models.question_version import QuestionVersion
from app.models.text_answer_key import TextAnswerKey
from app.models.user import User
from app.schemas.admin_question import QuestionDraftCreate, QuestionDraftEdit


class QuestionDraftScopeError(ValueError):
    """The selected certification/category scope is invalid."""


class QuestionBankNotFoundError(LookupError):
    """Question is absent or outside the current manager's permitted scope."""


class QuestionDraftNotEditableError(ValueError):
    """The current question version cannot be edited in place as a draft."""


class QuestionPublishedRevisionForbiddenError(PermissionError):
    """Only an Administrator may create a revision of published content."""


class QuestionDraftNotPublishableError(ValueError):
    """The latest question version cannot be approved and published."""


class QuestionDraftNotRejectableError(ValueError):
    """The latest question version cannot be rejected."""


@dataclass(frozen=True)
class CreatedQuestionDraft:
    """Identifiers and server-controlled state for a newly created draft."""

    question_id: UUID
    question_version_id: UUID
    version_number: int
    review_status: str
    publication_status: str


@dataclass(frozen=True)
class QuestionBankRecord:
    """Latest-version summary shown in the management question bank."""

    question_id: UUID
    question_version_id: UUID
    version_number: int
    question_preview: str
    certification_id: UUID
    certification_name: str
    category_id: UUID | None
    category_name: str | None
    difficulty: str
    question_type: str
    review_status: str
    publication_status: str
    is_flagged: bool
    created_by_id: UUID
    last_updated: datetime


@dataclass(frozen=True)
class QuestionBankOption:
    """Trusted answer option returned only to authorized question managers."""

    position: int
    option_text: str
    is_correct: bool


@dataclass(frozen=True)
class QuestionBankDetails:
    """Latest-version content and answer configuration for management."""

    question_id: UUID
    question_version_id: UUID
    version_number: int
    certification_id: UUID
    certification_name: str
    category_id: UUID | None
    category_name: str | None
    difficulty: str
    question_text: str
    question_type: str
    allows_multiple_answers: bool
    explanation: str | None
    review_status: str
    publication_status: str
    is_flagged: bool
    created_by_id: UUID
    submitted_by_id: UUID
    last_updated: datetime
    options: list[QuestionBankOption]
    expected_answer: str | None


def create_question_draft(
    session: Session,
    payload: QuestionDraftCreate,
    *,
    actor_id: UUID,
) -> CreatedQuestionDraft:
    """Create a question and version 1 atomically in pending/draft state."""
    _validate_question_scope(session, payload)

    question = Question(
        certification_id=payload.certification_id,
        category_id=payload.category_id,
        difficulty=payload.difficulty,
        created_by_id=actor_id,
    )

    version = QuestionVersion(
        question_id=question.id,
        version_number=1,
        question_text=payload.question_text,
        question_type=payload.question_type,
        allows_multiple_answers=payload.allows_multiple_answers,
        explanation=payload.explanation,
        review_status="pending",
        publication_status="draft",
        is_flagged=False,
        submitted_by_id=actor_id,
    )

    try:
        session.add(question)
        session.flush()

        session.add(version)
        session.flush()

        if payload.question_type == "multiple_choice":
            for position, option in enumerate(payload.options, start=1):
                session.add(
                    AnswerOption(
                        question_version_id=version.id,
                        option_text=option.option_text,
                        is_correct=option.is_correct,
                        position=position,
                    )
                )
        else:
            assert payload.expected_answer is not None
            session.add(
                TextAnswerKey(
                    question_version_id=version.id,
                    expected_answer=payload.expected_answer,
                )
            )

        session.commit()
    except Exception:
        session.rollback()
        raise

    return CreatedQuestionDraft(
        question_id=question.id,
        question_version_id=version.id,
        version_number=version.version_number,
        review_status=version.review_status,
        publication_status=version.publication_status,
    )


def edit_question_draft(
    session: Session,
    question_id: UUID,
    payload: QuestionDraftEdit,
    *,
    actor: User,
) -> QuestionBankDetails:
    """Replace editable fields on the current draft without changing its version.

    Contributors may edit only their own question records. Administrators may edit
    any permitted draft. Active/retired versions are not modified in place; their
    revision lifecycle is handled separately so historical exam content is preserved.
    """
    question = session.get(Question, question_id)
    if question is None or not _question_visible_to_actor(question, actor):
        raise QuestionBankNotFoundError("Question not found")

    version = _latest_version(session, question.id)

    if version.publication_status == "active":
        if actor.role != UserRole.ADMINISTRATOR:
            raise QuestionPublishedRevisionForbiddenError(
                "Only administrators can revise published questions"
            )

        return _create_published_revision(
            session,
            question=question,
            active_version=version,
            payload=payload,
            actor=actor,
        )

    if version.publication_status != "draft":
        raise QuestionDraftNotEditableError(
            "Only draft or active questions can be edited"
        )

    _validate_category_scope(
        session,
        certification_id=question.certification_id,
        category_id=payload.category_id,
    )

    try:
        question.category_id = payload.category_id
        question.difficulty = payload.difficulty

        version.question_text = payload.question_text
        version.question_type = payload.question_type
        version.allows_multiple_answers = payload.allows_multiple_answers
        version.explanation = payload.explanation
        version.review_status = "pending"
        version.publication_status = "draft"
        version.submitted_by_id = actor.id
        version.submitted_at = datetime.now(UTC)
        version.reviewed_by_id = None
        version.reviewed_at = None
        version.review_note = None

        existing_options = session.exec(
            select(AnswerOption).where(AnswerOption.question_version_id == version.id)
        ).all()

        for option in existing_options:
            session.delete(option)

        existing_key = session.exec(
            select(TextAnswerKey).where(TextAnswerKey.question_version_id == version.id)
        ).first()

        if existing_key is not None:
            session.delete(existing_key)

        # Make removals visible before inserting replacement rows with the same
        # version/position keys. A later failure still rolls the transaction back.
        session.flush()

        if payload.question_type == "multiple_choice":
            for position, option in enumerate(payload.options, start=1):
                session.add(
                    AnswerOption(
                        question_version_id=version.id,
                        option_text=option.option_text,
                        is_correct=option.is_correct,
                        position=position,
                    )
                )
        else:
            assert payload.expected_answer is not None
            session.add(
                TextAnswerKey(
                    question_version_id=version.id,
                    expected_answer=payload.expected_answer,
                )
            )

        session.commit()
    except Exception:
        session.rollback()
        raise

    return get_question_bank_details(
        session,
        question.id,
        actor=actor,
    )


def _create_published_revision(
    session: Session,
    *,
    question: Question,
    active_version: QuestionVersion,
    payload: QuestionDraftEdit,
    actor: User,
) -> QuestionBankDetails:
    """Create a new pending/draft version while preserving the active version.

    Category and difficulty live on the parent ``questions`` row in the current
    schema. Changing either while an older version remains active would alter the
    live question's management scope before approval, so published revisions must
    preserve those parent-level values. Content, answer configuration, explanation,
    and version-pinned image references are safely versioned here.
    """
    if (
        payload.category_id != question.category_id
        or payload.difficulty != question.difficulty
    ):
        raise QuestionDraftScopeError(
            "Published revisions cannot change category or difficulty"
        )

    revision = QuestionVersion(
        question_id=question.id,
        version_number=active_version.version_number + 1,
        question_text=payload.question_text,
        question_type=payload.question_type,
        allows_multiple_answers=payload.allows_multiple_answers,
        explanation=payload.explanation,
        review_status="pending",
        publication_status="draft",
        is_flagged=False,
        submitted_by_id=actor.id,
    )

    try:
        session.add(revision)
        session.flush()

        if payload.question_type == "multiple_choice":
            for position, option in enumerate(payload.options, start=1):
                session.add(
                    AnswerOption(
                        question_version_id=revision.id,
                        option_text=option.option_text,
                        is_correct=option.is_correct,
                        position=position,
                    )
                )
        else:
            assert payload.expected_answer is not None
            session.add(
                TextAnswerKey(
                    question_version_id=revision.id,
                    expected_answer=payload.expected_answer,
                )
            )

        images = session.exec(
            select(QuestionImage)
            .where(QuestionImage.question_version_id == active_version.id)
            .order_by(QuestionImage.position)
        ).all()

        for image in images:
            session.add(
                QuestionImage(
                    question_version_id=revision.id,
                    storage_key=image.storage_key,
                    alt_text=image.alt_text,
                    media_type=image.media_type,
                    position=image.position,
                )
            )

        session.commit()
    except Exception:
        session.rollback()
        raise

    return get_question_bank_details(
        session,
        question.id,
        actor=actor,
    )


def publish_question_draft(
    session: Session,
    question_id: UUID,
    *,
    actor: User,
) -> QuestionBankDetails:
    """Approve and activate the latest pending draft version.

    If an older version is currently active, retire it before activating
    the newer revision so only one active version exists per question.
    """
    question = session.get(Question, question_id)

    if question is None:
        raise QuestionBankNotFoundError("Question not found")

    version = _latest_version(session, question.id)

    if version.publication_status != "draft" or version.review_status != "pending":
        raise QuestionDraftNotPublishableError(
            "Only pending draft questions can be published"
        )

    active_version = session.exec(
        select(QuestionVersion).where(
            QuestionVersion.question_id == question.id,
            QuestionVersion.publication_status == "active",
        )
    ).first()

    try:
        # A published revision replaces the previous active version.
        # Flush the retirement first because the database enforces
        # one active version per parent question.
        if active_version is not None:
            active_version.publication_status = "retired"
            session.add(active_version)
            session.flush()

        version.review_status = "approved"
        version.publication_status = "active"
        version.reviewed_by_id = actor.id
        version.reviewed_at = datetime.now(UTC)
        version.review_note = None

        session.add(version)
        session.commit()
    except Exception:
        session.rollback()
        raise

    return get_question_bank_details(
        session,
        question.id,
        actor=actor,
    )


def reject_question_draft(
    session: Session,
    question_id: UUID,
    *,
    actor: User,
    review_note: str,
) -> QuestionBankDetails:
    """Reject the latest pending draft without disturbing live content.

    If the draft is a revision of an already published question, the older
    active version remains active. Editing the rejected draft later resets it
    to pending so it can be reviewed again.
    """
    question = session.get(Question, question_id)

    if question is None:
        raise QuestionBankNotFoundError("Question not found")

    version = _latest_version(session, question.id)

    if version.publication_status != "draft" or version.review_status != "pending":
        raise QuestionDraftNotRejectableError(
            "Only pending draft questions can be rejected"
        )

    try:
        version.review_status = "rejected"
        version.reviewed_by_id = actor.id
        version.reviewed_at = datetime.now(UTC)
        version.review_note = review_note

        session.add(version)
        session.commit()
    except Exception:
        session.rollback()
        raise

    return get_question_bank_details(
        session,
        question.id,
        actor=actor,
    )


def list_question_bank(
    session: Session,
    *,
    actor: User,
) -> list[QuestionBankRecord]:
    """Return question-bank rows permitted by the manager's role."""
    statement = select(Question)

    if actor.role == UserRole.CONTRIBUTOR:
        statement = statement.where(Question.created_by_id == actor.id)
    elif actor.role != UserRole.ADMINISTRATOR:
        return []

    records = [
        _question_bank_record(
            session,
            question,
        )
        for question in session.exec(statement).all()
    ]

    records.sort(
        key=lambda item: item.last_updated,
        reverse=True,
    )

    return records


def get_question_bank_details(
    session: Session,
    question_id: UUID,
    *,
    actor: User,
) -> QuestionBankDetails:
    """Return latest-version management data within the actor's role scope."""
    question = session.get(
        Question,
        question_id,
    )

    if question is None or not _question_visible_to_actor(
        question,
        actor,
    ):
        raise QuestionBankNotFoundError("Question not found")

    version = _latest_version(
        session,
        question.id,
    )

    certification = session.get(
        Certification,
        question.certification_id,
    )
    assert certification is not None

    category = (
        session.get(
            Category,
            question.category_id,
        )
        if question.category_id is not None
        else None
    )

    options: list[QuestionBankOption] = []
    expected_answer: str | None = None

    if version.question_type == "multiple_choice":
        option_rows = session.exec(
            select(AnswerOption)
            .where(AnswerOption.question_version_id == version.id)
            .order_by(AnswerOption.position)
        ).all()

        options = [
            QuestionBankOption(
                position=option.position,
                option_text=option.option_text,
                is_correct=option.is_correct,
            )
            for option in option_rows
        ]

    else:
        answer_key = session.exec(
            select(TextAnswerKey).where(TextAnswerKey.question_version_id == version.id)
        ).first()

        if answer_key is not None:
            expected_answer = answer_key.expected_answer

    return QuestionBankDetails(
        question_id=question.id,
        question_version_id=version.id,
        version_number=version.version_number,
        certification_id=question.certification_id,
        certification_name=certification.name,
        category_id=question.category_id,
        category_name=(category.name if category is not None else None),
        difficulty=question.difficulty,
        question_text=version.question_text,
        question_type=version.question_type,
        allows_multiple_answers=(version.allows_multiple_answers),
        explanation=version.explanation,
        review_status=version.review_status,
        publication_status=(version.publication_status),
        is_flagged=version.is_flagged,
        created_by_id=question.created_by_id,
        submitted_by_id=version.submitted_by_id,
        last_updated=version.submitted_at,
        options=options,
        expected_answer=expected_answer,
    )


def _validate_question_scope(
    session: Session,
    payload: QuestionDraftCreate,
) -> None:
    certification = session.get(
        Certification,
        payload.certification_id,
    )

    if certification is None:
        raise QuestionDraftScopeError("Certification not found")

    _validate_category_scope(
        session,
        certification_id=payload.certification_id,
        category_id=payload.category_id,
    )


def _validate_category_scope(
    session: Session,
    *,
    certification_id: UUID,
    category_id: UUID | None,
) -> None:
    if category_id is None:
        return

    category = session.get(
        Category,
        category_id,
    )

    if category is None:
        raise QuestionDraftScopeError("Category not found")

    if category.certification_id != certification_id:
        raise QuestionDraftScopeError(
            "Category does not belong to the selected certification"
        )


def _question_visible_to_actor(
    question: Question,
    actor: User,
) -> bool:
    if actor.role == UserRole.ADMINISTRATOR:
        return True

    return actor.role == UserRole.CONTRIBUTOR and question.created_by_id == actor.id


def _question_bank_record(
    session: Session,
    question: Question,
) -> QuestionBankRecord:
    version = _latest_version(
        session,
        question.id,
    )

    certification = session.get(
        Certification,
        question.certification_id,
    )
    assert certification is not None

    category = (
        session.get(
            Category,
            question.category_id,
        )
        if question.category_id is not None
        else None
    )

    return QuestionBankRecord(
        question_id=question.id,
        question_version_id=version.id,
        version_number=version.version_number,
        question_preview=_preview(version.question_text),
        certification_id=(question.certification_id),
        certification_name=certification.name,
        category_id=question.category_id,
        category_name=(category.name if category is not None else None),
        difficulty=question.difficulty,
        question_type=version.question_type,
        review_status=version.review_status,
        publication_status=(version.publication_status),
        is_flagged=version.is_flagged,
        created_by_id=question.created_by_id,
        last_updated=version.submitted_at,
    )


def _latest_version(
    session: Session,
    question_id: UUID,
) -> QuestionVersion:
    version = session.exec(
        select(QuestionVersion)
        .where(QuestionVersion.question_id == question_id)
        .order_by(QuestionVersion.version_number.desc())
    ).first()

    if version is None:
        raise QuestionBankNotFoundError("Question not found")

    return version


def _preview(
    question_text: str,
    limit: int = 160,
) -> str:
    if len(question_text) <= limit:
        return question_text

    return f"{question_text[: limit - 3]}..."
