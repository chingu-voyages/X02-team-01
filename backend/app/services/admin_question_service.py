"""Persistence services for administrator/contributor question management."""

from dataclasses import dataclass
from dataclasses import field as dataclass_field
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func
from sqlmodel import Session, select

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
from app.schemas.admin_question import (
    QuestionDraftCreate,
    QuestionDraftEdit,
)
from app.services.media_url import resolve_media_url


class QuestionDraftScopeError(ValueError):
    """The selected certification/category scope is invalid."""


class QuestionBankNotFoundError(LookupError):
    """Question is absent or outside the current manager's permitted scope."""


class QuestionDraftNotEditableError(ValueError):
    """Current question version cannot be edited in place."""


class QuestionPublishedRevisionForbiddenError(PermissionError):
    """Only an Administrator may revise published content."""


class QuestionReviewTransitionError(ValueError):
    """An invalid or out-of-order review-workflow transition (JHEP-119)."""


class QuestionBankNotAuthorizedError(Exception):
    """The actor cannot perform this action on this question."""


class QuestionDraftNotPublishableError(ValueError):
    """Latest version cannot be approved and published."""


class QuestionDraftNotRejectableError(ValueError):
    """Latest version cannot be rejected."""


class QuestionRubricTotalMismatchError(QuestionDraftScopeError):
    """JHEP-121 AC2: the rubric total does not match the criterion sum."""


# The permitted default for short-answer drafts that omit an explicit
# rubric: one criterion at one point, matching the implicit per-question
# value the rest of the grading pipeline already assumes.
DEFAULT_SHORT_ANSWER_RUBRIC: tuple[tuple[str, int], ...] = (("Correct response", 1),)


def _resolved_rubric(
    payload: QuestionDraftCreate | QuestionDraftEdit,
    *,
    existing_criteria: list[RubricCriterion] | None = None,
) -> tuple[list[tuple[str, int]], int, str | None]:
    """Validate and resolve a written question's rubric.

    Returns (criteria, max_points, criteria_markdown). The version's total
    is the criterion sum; an explicit max_points must match it (AC2).
    Editing without a new rubric keeps the existing criteria (AC6: never
    silently erase authored criteria).
    """
    if payload.rubric is not None:
        criteria = [(criterion.name, criterion.points) for criterion in payload.rubric]
        markdown = payload.criteria_markdown
    elif existing_criteria:
        criteria = [
            (criterion.name, criterion.points) for criterion in existing_criteria
        ]
        markdown = payload.criteria_markdown
    else:
        criteria = list(DEFAULT_SHORT_ANSWER_RUBRIC)
        markdown = payload.criteria_markdown

    total = sum(points for _, points in criteria)

    if payload.max_points is not None and payload.max_points != total:
        raise QuestionRubricTotalMismatchError(
            f"max_points ({payload.max_points}) must equal the sum of the "
            f"criterion points ({total})"
        )

    return criteria, total, markdown


def _persist_written_answer_key(
    session: Session,
    version_id: UUID,
    expected_answer: str,
    criteria: list[tuple[str, int]],
    max_points: int,
    criteria_markdown: str | None,
) -> None:
    """Store the model answer, the rubric criteria and the total."""
    session.add(
        TextAnswerKey(
            question_version_id=version_id,
            expected_answer=expected_answer,
            max_points=max_points,
            criteria_markdown=criteria_markdown,
        )
    )

    for position, (name, points) in enumerate(criteria, start=1):
        session.add(
            RubricCriterion(
                question_version_id=version_id,
                position=position,
                name=name,
                points=points,
            )
        )

    session.flush()


def _load_rubric_criteria(
    session: Session,
    version_id: UUID,
) -> list[RubricCriterion]:
    return list(
        session.exec(
            select(RubricCriterion)
            .where(RubricCriterion.question_version_id == version_id)
            .order_by(RubricCriterion.position)
        )
    )


def _delete_written_key(session: Session, version_id: UUID) -> None:
    """Remove the version's key and rubric rows (draft replace/retype)."""
    existing_key = session.exec(
        select(TextAnswerKey).where(TextAnswerKey.question_version_id == version_id)
    ).first()
    if existing_key is not None:
        session.delete(existing_key)

    for criterion in _load_rubric_criteria(session, version_id):
        session.delete(criterion)


@dataclass(frozen=True)
class CreatedQuestionDraft:
    question_id: UUID
    question_version_id: UUID
    version_number: int
    review_status: str
    publication_status: str


@dataclass(frozen=True)
class QuestionBankRecord:
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
    review_note: str | None
    is_flagged: bool
    created_by_id: UUID
    last_updated: datetime


@dataclass(frozen=True)
class QuestionBankOption:
    position: int
    option_text: str
    is_correct: bool


@dataclass(frozen=True)
class QuestionBankImage:
    """Safe media metadata for management screens."""

    id: UUID
    question_version_id: UUID
    position: int
    alt_text: str
    media_type: str
    url: str | None


@dataclass(frozen=True)
class QuestionBankCriterion:
    position: int
    name: str
    points: int


@dataclass(frozen=True)
class QuestionBankDetails:
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
    review_note: str | None
    is_flagged: bool
    created_by_id: UUID
    submitted_by_id: UUID
    last_updated: datetime
    options: list[QuestionBankOption]
    expected_answer: str | None
    max_points: int | None = None
    criteria_markdown: str | None = None
    rubric: list[QuestionBankCriterion] = dataclass_field(default_factory=list)
    images: list[QuestionBankImage] = dataclass_field(default_factory=list)


def add_question_draft(
    session: Session,
    payload: QuestionDraftCreate,
    *,
    actor_id: UUID,
) -> CreatedQuestionDraft:
    """Add one pending Draft question without committing the transaction."""

    _validate_question_scope(
        session,
        payload,
    )

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
        allows_multiple_answers=(payload.allows_multiple_answers),
        explanation=payload.explanation,
        review_status="pending",
        publication_status="draft",
        is_flagged=False,
        submitted_by_id=actor_id,
    )

    session.add(question)
    session.flush()

    session.add(version)
    session.flush()

    if payload.question_type == "multiple_choice":
        for position, option in enumerate(
            payload.options,
            start=1,
        ):
            session.add(
                AnswerOption(
                    question_version_id=(version.id),
                    option_text=(option.option_text),
                    is_correct=(option.is_correct),
                    position=position,
                )
            )

    else:
        assert payload.expected_answer is not None

        criteria, max_points, criteria_markdown = _resolved_rubric(payload)

        _persist_written_answer_key(
            session,
            version.id,
            payload.expected_answer,
            criteria,
            max_points,
            criteria_markdown,
        )

    # Surface child-record constraints while remaining transaction-neutral.
    session.flush()

    return CreatedQuestionDraft(
        question_id=question.id,
        question_version_id=(version.id),
        version_number=(version.version_number),
        review_status=(version.review_status),
        publication_status=(version.publication_status),
    )


def create_question_draft(
    session: Session,
    payload: QuestionDraftCreate,
    *,
    actor_id: UUID,
) -> CreatedQuestionDraft:
    """Create one Draft using the normal single-question transaction."""

    try:
        created = add_question_draft(
            session,
            payload,
            actor_id=actor_id,
        )
        session.commit()

    except Exception:
        session.rollback()
        raise

    return created


def edit_question_draft(
    session: Session,
    question_id: UUID,
    payload: QuestionDraftEdit,
    *,
    actor: User,
) -> QuestionBankDetails:
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

    if version.publication_status == "active":
        if actor.role != UserRole.ADMINISTRATOR:
            raise (
                QuestionPublishedRevisionForbiddenError(
                    "Only administrators can revise published questions"
                )
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
        certification_id=(question.certification_id),
        category_id=payload.category_id,
    )

    actor_id = actor.id
    submitted_at = datetime.now(UTC)

    try:
        question.category_id = payload.category_id
        question.difficulty = payload.difficulty

        version.question_text = payload.question_text
        version.question_type = payload.question_type
        version.allows_multiple_answers = payload.allows_multiple_answers
        version.explanation = payload.explanation

        version.review_status = "pending"
        version.publication_status = "draft"
        version.submitted_by_id = actor_id
        version.submitted_at = submitted_at
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

        # JHEP-121 AC6: a written-type edit that omits the rubric keeps the
        # previously authored criteria instead of silently erasing them.
        existing_criteria = _load_rubric_criteria(session, version.id)

        for criterion in existing_criteria:
            session.delete(criterion)

        session.flush()

        if payload.question_type == "multiple_choice":
            for position, option in enumerate(
                payload.options,
                start=1,
            ):
                session.add(
                    AnswerOption(
                        question_version_id=(version.id),
                        option_text=(option.option_text),
                        is_correct=(option.is_correct),
                        position=position,
                    )
                )

        else:
            assert payload.expected_answer is not None

            carried_criteria = None if payload.rubric is not None else existing_criteria

            criteria, max_points, criteria_markdown = _resolved_rubric(
                payload,
                existing_criteria=carried_criteria,
            )

            _persist_written_answer_key(
                session,
                version.id,
                payload.expected_answer,
                criteria,
                max_points,
                criteria_markdown,
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
    if (
        payload.category_id != question.category_id
        or payload.difficulty != question.difficulty
    ):
        raise QuestionDraftScopeError(
            "Published revisions cannot change category or difficulty"
        )

    actor_id = actor.id

    revision = QuestionVersion(
        question_id=question.id,
        version_number=(active_version.version_number + 1),
        question_text=(payload.question_text),
        question_type=(payload.question_type),
        allows_multiple_answers=(payload.allows_multiple_answers),
        explanation=(payload.explanation),
        review_status="pending",
        publication_status="draft",
        is_flagged=False,
        submitted_by_id=actor_id,
    )

    try:
        session.add(revision)
        session.flush()

        if payload.question_type == "multiple_choice":
            for position, option in enumerate(
                payload.options,
                start=1,
            ):
                session.add(
                    AnswerOption(
                        question_version_id=(revision.id),
                        option_text=(option.option_text),
                        is_correct=(option.is_correct),
                        position=position,
                    )
                )

        else:
            assert payload.expected_answer is not None

            carried_criteria = (
                None
                if payload.rubric is not None
                else (_load_rubric_criteria(session, active_version.id))
            )

            criteria, max_points, criteria_markdown = _resolved_rubric(
                payload,
                existing_criteria=carried_criteria,
            )

            _persist_written_answer_key(
                session,
                revision.id,
                payload.expected_answer,
                criteria,
                max_points,
                criteria_markdown,
            )

        images = session.exec(
            select(QuestionImage)
            .where(QuestionImage.question_version_id == active_version.id)
            .order_by(QuestionImage.position)
        ).all()

        for image in images:
            session.add(
                QuestionImage(
                    question_version_id=(revision.id),
                    storage_key=(image.storage_key),
                    alt_text=(image.alt_text),
                    media_type=(image.media_type),
                    position=(image.position),
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


def submit_question_for_review(
    session: Session,
    question_id: UUID,
    *,
    actor: User,
) -> QuestionBankDetails:
    """JHEP-119 AC1: a Contributor submits THEIR OWN valid Draft toward
    review. Submission never publishes; the ownership is enforced by the
    actor scoping (a Contributor can only ever reach their own
    questions)."""
    question = session.get(Question, question_id)

    if question is None:
        raise QuestionBankNotFoundError("Question not found")

    if not _question_visible_to_actor(question, actor):
        raise QuestionBankNotAuthorizedError("You can only submit your own questions")

    version = _latest_version(session, question.id)

    if version.publication_status != "draft" or version.review_status != "pending":
        raise QuestionReviewTransitionError(
            "Only pending draft questions can be submitted for review"
        )

    version.review_status = "submitted"
    version.submitted_by_id = actor.id
    version.submitted_at = datetime.now(UTC)

    session.add(version)
    session.commit()

    return get_question_bank_details(session, question.id, actor=actor)


def start_question_review(
    session: Session,
    question_id: UUID,
    *,
    actor: User,
) -> QuestionBankDetails:
    """JHEP-119 AC2: an Administrator starts the review — Submitted ->
    In Review, stamped with the reviewer (the DB constraint requires a
    reviewer on non-pending states)."""
    if actor.role != UserRole.ADMINISTRATOR:
        raise QuestionBankNotAuthorizedError("Only Administrators can start a review")

    question = session.get(Question, question_id)

    if question is None:
        raise QuestionBankNotFoundError("Question not found")

    version = _latest_version(session, question.id)

    if version.review_status != "submitted":
        raise QuestionReviewTransitionError("Only submitted questions can enter review")

    version.review_status = "in_review"
    version.reviewed_by_id = actor.id
    version.reviewed_at = datetime.now(UTC)

    session.add(version)
    session.commit()

    return get_question_bank_details(session, question.id, actor=actor)


def request_question_changes(
    session: Session,
    question_id: UUID,
    *,
    actor: User,
    review_note: str,
) -> QuestionBankDetails:
    """JHEP-119 AC3: from In Review, return the question to the author's
    editable Draft with the required reason kept as feedback. The
    review state resets to pending — resubmittable after rework."""
    if actor.role != UserRole.ADMINISTRATOR:
        raise QuestionBankNotAuthorizedError("Only Administrators can request changes")

    question = session.get(Question, question_id)

    if question is None:
        raise QuestionBankNotFoundError("Question not found")

    version = _latest_version(session, question.id)

    if version.review_status != "in_review":
        raise QuestionReviewTransitionError(
            "Only in-review questions can have changes requested"
        )

    version.review_status = "pending"
    version.publication_status = "draft"
    version.review_note = review_note
    version.reviewed_by_id = actor.id
    version.reviewed_at = datetime.now(UTC)

    session.add(version)
    session.commit()

    return get_question_bank_details(session, question.id, actor=actor)


def publish_question_draft(
    session: Session,
    question_id: UUID,
    *,
    actor: User,
) -> QuestionBankDetails:
    question = session.get(
        Question,
        question_id,
    )

    if question is None:
        raise QuestionBankNotFoundError("Question not found")

    version = _latest_version(
        session,
        question.id,
    )

    # JHEP-119: publish accepts the review-workflow source (in_review)
    # and keeps the admin-authored direct path (pending/draft) — one
    # publishing implementation (the scope boundary).
    if version.publication_status != "draft" or version.review_status not in (
        "pending",
        "in_review",
    ):
        raise QuestionDraftNotPublishableError(
            "Only pending draft or in-review questions can be published"
        )

    actor_id = actor.id

    reviewed_at = datetime.now(UTC)

    active_version = session.exec(
        select(QuestionVersion).where(
            QuestionVersion.question_id == question.id,
            QuestionVersion.publication_status == "active",
        )
    ).first()

    try:
        if active_version is not None:
            active_version.publication_status = "retired"

            session.add(active_version)

            session.flush()

        version.reviewed_by_id = actor_id
        version.reviewed_at = reviewed_at
        version.review_note = None

        version.review_status = "approved"
        version.publication_status = "active"

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
    question = session.get(
        Question,
        question_id,
    )

    if question is None:
        raise QuestionBankNotFoundError("Question not found")

    version = _latest_version(
        session,
        question.id,
    )

    # JHEP-119 AC3/AC4: Reject applies to submitted AND in-review
    # questions (the admin-authored pending/draft path keeps the direct
    # publish instead), and the outcome is TERMINAL: publication_status
    # becomes 'inactive' — retained, never silently reactivated by
    # editing (the old "edit resets a rejected draft" behavior violated
    # AC4 and is removed; see the test updates in this PR).
    if version.review_status not in ("submitted", "in_review"):
        raise QuestionDraftNotRejectableError(
            "Only submitted or in-review questions can be rejected"
        )

    actor_id = actor.id

    reviewed_at = datetime.now(UTC)

    try:
        version.reviewed_by_id = actor_id
        version.reviewed_at = reviewed_at
        version.review_note = review_note

        version.review_status = "rejected"
        version.publication_status = "inactive"

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
    review_status: str | None = None,
    author_email: str | None = None,
) -> list[QuestionBankRecord]:
    """JHEP-119 AC2: the review queue — optional server-side filters for
    the review status and the author email, on top of the role scoping."""
    statement = select(Question)

    if actor.role == UserRole.CONTRIBUTOR:
        statement = statement.where(Question.created_by_id == actor.id)

    elif actor.role != UserRole.ADMINISTRATOR:
        return []

    if review_status:
        # a queue is built from the review-workflow states
        statement = statement.join(
            QuestionVersion,
            QuestionVersion.question_id == Question.id,
        ).where(QuestionVersion.review_status == review_status)
    if author_email:
        statement = statement.join(
            User,
            User.id == Question.created_by_id,
        ).where(func.lower(User.email) == author_email.strip().lower())

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
        if (question.category_id is not None)
        else None
    )

    options: list[QuestionBankOption] = []

    expected_answer: str | None = None
    max_points: int | None = None
    criteria_markdown: str | None = None
    rubric: list[QuestionBankCriterion] = []

    if version.question_type == "multiple_choice":
        option_rows = session.exec(
            select(AnswerOption)
            .where(AnswerOption.question_version_id == version.id)
            .order_by(AnswerOption.position)
        ).all()

        options = [
            QuestionBankOption(
                position=(option.position),
                option_text=(option.option_text),
                is_correct=(option.is_correct),
            )
            for option in option_rows
        ]

    else:
        answer_key = session.exec(
            select(TextAnswerKey).where(TextAnswerKey.question_version_id == version.id)
        ).first()

        if answer_key is not None:
            expected_answer = answer_key.expected_answer
            max_points = answer_key.max_points
            criteria_markdown = answer_key.criteria_markdown
            rubric = [
                QuestionBankCriterion(
                    position=criterion.position,
                    name=criterion.name,
                    points=criterion.points,
                )
                for criterion in _load_rubric_criteria(session, version.id)
            ]

    image_rows = session.exec(
        select(QuestionImage)
        .where(QuestionImage.question_version_id == version.id)
        .order_by(QuestionImage.position)
    ).all()

    images = [
        QuestionBankImage(
            id=image.id,
            question_version_id=(image.question_version_id),
            position=image.position,
            alt_text=image.alt_text,
            media_type=image.media_type,
            url=resolve_media_url(image.storage_key),
        )
        for image in image_rows
        if image.media_type
        in {
            "image/png",
            "image/jpeg",
            "image/webp",
        }
    ]

    return QuestionBankDetails(
        question_id=question.id,
        question_version_id=(version.id),
        version_number=(version.version_number),
        certification_id=(question.certification_id),
        certification_name=(certification.name),
        category_id=(question.category_id),
        category_name=(category.name if category is not None else None),
        difficulty=(question.difficulty),
        question_text=(version.question_text),
        question_type=(version.question_type),
        allows_multiple_answers=(version.allows_multiple_answers),
        explanation=(version.explanation),
        review_status=(version.review_status),
        publication_status=(version.publication_status),
        review_note=(version.review_note),
        is_flagged=(version.is_flagged),
        created_by_id=(question.created_by_id),
        submitted_by_id=(version.submitted_by_id),
        last_updated=(version.submitted_at),
        options=options,
        expected_answer=(expected_answer),
        max_points=max_points,
        criteria_markdown=criteria_markdown,
        rubric=rubric,
        images=images,
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
        certification_id=(payload.certification_id),
        category_id=(payload.category_id),
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
        if (question.category_id is not None)
        else None
    )

    return QuestionBankRecord(
        question_id=(question.id),
        question_version_id=(version.id),
        version_number=(version.version_number),
        question_preview=_preview(version.question_text),
        certification_id=(question.certification_id),
        certification_name=(certification.name),
        category_id=(question.category_id),
        category_name=(category.name if category is not None else None),
        difficulty=(question.difficulty),
        question_type=(version.question_type),
        review_status=(version.review_status),
        publication_status=(version.publication_status),
        is_flagged=(version.is_flagged),
        created_by_id=(question.created_by_id),
        last_updated=(version.submitted_at),
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
