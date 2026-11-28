"""Read-only, attempt-scoped question previews for JHEP-37."""

from sqlalchemy import and_
from sqlmodel import Session, select

from app.models import (
    ExamAttempt,
    ExamAttemptQuestion,
    ExamQuestionGrade,
    ExamResponse,
    QuestionVersion,
)
from app.schemas.exam_review import (
    CompletedExamReviewOut,
    ReviewQuestionOut,
    ReviewStatus,
)
from app.services.grading_service import AttemptNotSubmittedError

PREVIEW_LIMIT = 160


def _preview(question_text: str, position: int) -> str:
    text = " ".join(question_text.split()) or f"Question {position}"
    if len(text) > PREVIEW_LIMIT:
        return text[: PREVIEW_LIMIT - 1].rstrip() + "…"
    return text


def _review_status(
    question_type: str,
    grade: ExamQuestionGrade | None,
    response: ExamResponse | None,
) -> ReviewStatus:
    # These are persisted grading outcomes, not a new scoring calculation.
    outcome = grade.outcome if grade is not None else None
    if outcome == "correct":
        return "correct"
    if outcome == "incorrect":
        return "incorrect"
    if outcome == "unanswered":
        return "unanswered"
    if outcome == "manually_graded":
        return "manually_graded"
    # Only submitted responses are joined; a saved draft is not an answer.
    if response is None:
        return "unanswered"
    if (
        outcome == "ungraded"
        and question_type != "multiple_choice"
        and response.text_response
    ):
        return "pending_manual_grading"
    return "unavailable"


def completed_review_payload(
    session: Session, attempt: ExamAttempt
) -> CompletedExamReviewOut:
    """Read pinned questions for an already authorized, submitted attempt.

    Pinned positions, not grade rows or current bank publication state,
    define the list. Left joins preserve questions without a grade/response.
    No answer-key query, grading, submission, or database write is needed.
    """
    if attempt.status != "submitted":
        raise AttemptNotSubmittedError("Attempt must be submitted first")

    rows = session.exec(
        select(ExamAttemptQuestion, QuestionVersion, ExamQuestionGrade, ExamResponse)
        .select_from(ExamAttemptQuestion)
        .join(
            QuestionVersion,
            QuestionVersion.id == ExamAttemptQuestion.question_version_id,
        )
        .outerjoin(
            ExamQuestionGrade,
            and_(
                ExamQuestionGrade.attempt_id == ExamAttemptQuestion.attempt_id,
                ExamQuestionGrade.question_version_id
                == ExamAttemptQuestion.question_version_id,
            ),
        )
        .outerjoin(
            ExamResponse,
            and_(
                ExamResponse.attempt_id == ExamAttemptQuestion.attempt_id,
                ExamResponse.question_version_id
                == ExamAttemptQuestion.question_version_id,
                ExamResponse.is_submitted.is_(True),
            ),
        )
        .where(ExamAttemptQuestion.attempt_id == attempt.id)
        .order_by(ExamAttemptQuestion.position)
    ).all()

    return CompletedExamReviewOut(
        attempt_id=attempt.id,
        status="submitted",
        question_count=attempt.question_count,
        questions=[
            ReviewQuestionOut(
                question_version_id=pinned.question_version_id,
                position=pinned.position,
                preview=_preview(version.question_text, pinned.position),
                status=_review_status(version.question_type, grade, response),
            )
            for pinned, version, grade, response in rows
        ],
    )
