"""Persistence services for administrator/contributor question management."""

from dataclasses import dataclass
from uuid import UUID

from sqlmodel import Session

from app.models.answer_option import AnswerOption
from app.models.category import Category
from app.models.certification import Certification
from app.models.question import Question
from app.models.question_version import QuestionVersion
from app.models.text_answer_key import TextAnswerKey
from app.schemas.admin_question import QuestionDraftCreate


class QuestionDraftScopeError(ValueError):
    """The selected certification/category scope is invalid."""


@dataclass(frozen=True)
class CreatedQuestionDraft:
    """Identifiers and server-controlled state for a newly created draft."""

    question_id: UUID
    question_version_id: UUID
    version_number: int
    review_status: str
    publication_status: str


def create_question_draft(
    session: Session,
    payload: QuestionDraftCreate,
    *,
    actor_id: UUID,
) -> CreatedQuestionDraft:
    """Create a question and version 1 atomically in pending/draft state.

    Authorization is enforced by the HTTP dependency layer before calling this
    service. ``actor_id`` is therefore the trusted authenticated account id.
    """
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
            # The request schema guarantees this is present for short-answer.
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


def _validate_question_scope(
    session: Session,
    payload: QuestionDraftCreate,
) -> None:
    certification = session.get(Certification, payload.certification_id)
    if certification is None:
        raise QuestionDraftScopeError("Certification not found")

    if payload.category_id is None:
        return

    category = session.get(Category, payload.category_id)
    if category is None:
        raise QuestionDraftScopeError("Category not found")

    if category.certification_id != payload.certification_id:
        raise QuestionDraftScopeError(
            "Category does not belong to the selected certification"
        )
