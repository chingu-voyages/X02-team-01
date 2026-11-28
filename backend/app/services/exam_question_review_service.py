"""Read one owned, completed, version-pinned question without any writes."""

from uuid import UUID

from sqlalchemy import and_
from sqlmodel import Session, select

from app.models import (
    AnswerOption,
    ExamAttemptQuestion,
    ExamQuestionGrade,
    ExamResponse,
    QuestionImage,
    QuestionVersion,
)
from app.schemas.exam import ExamImageOut, ExamOptionOut
from app.schemas.exam_question_review import (
    CompletedQuestionReviewOut,
    QuestionReviewGradeOut,
    SubmittedReviewResponseOut,
)
from app.services.exam_review_service import _review_status
from app.services.exam_service import ExamAttemptNotFoundError, ExamService
from app.services.grading_service import AttemptNotSubmittedError
from app.services.media_url import resolve_media_url


class HistoricalReviewUnavailableError(RuntimeError):
    """Recorded detail is inconsistent; never silently invent an answer."""


def _nonblank(value: str | None) -> str | None:
    # Preserve original whitespace/math/Unicode when content is present.
    return value if value is not None and value.strip() else None


def _submitted_response(
    response: ExamResponse | None,
    question_type: str,
    option_ids: set[UUID],
) -> SubmittedReviewResponseOut | None:
    if response is None or not response.is_submitted:
        return None

    if question_type == "multiple_choice":
        raw_ids = response.selected_option_ids
        if not isinstance(raw_ids, list) or not raw_ids:
            raise HistoricalReviewUnavailableError("Invalid recorded selection")
        try:
            selected = [UUID(str(value)) for value in raw_ids]
        except (ValueError, TypeError, AttributeError) as exc:
            raise HistoricalReviewUnavailableError(
                "Invalid recorded selection"
            ) from exc
        if len(selected) != len(set(selected)) or not set(selected) <= option_ids:
            raise HistoricalReviewUnavailableError("Invalid recorded selection")
        return SubmittedReviewResponseOut(
            selected_option_ids=selected,
            answered_at=response.answered_at,
            question_submitted_at=response.question_submitted_at,
        )

    if _nonblank(response.text_response) is None:
        raise HistoricalReviewUnavailableError("Missing recorded written response")
    return SubmittedReviewResponseOut(
        text_response=response.text_response,
        answered_at=response.answered_at,
        question_submitted_at=response.question_submitted_at,
    )


class ExamQuestionReviewService:
    """Ownership and completion checks precede all question/answer-key reads."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def read(
        self,
        *,
        attempt_id: UUID,
        question_version_id: UUID,
        learner_id: UUID,
    ) -> CompletedQuestionReviewOut:
        # Prevent a SELECT from flushing any unrelated pending ORM changes.
        with self._session.no_autoflush:
            attempt = ExamService(self._session).get_owned_attempt(
                attempt_id=attempt_id,
                learner_id=learner_id,
            )
            if attempt.status != "submitted":
                raise AttemptNotSubmittedError("Attempt must be submitted first")

            row = self._session.exec(
                select(
                    ExamAttemptQuestion,
                    QuestionVersion,
                    ExamQuestionGrade,
                    ExamResponse,
                )
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
                .where(
                    ExamAttemptQuestion.attempt_id == attempt.id,
                    ExamAttemptQuestion.question_version_id == question_version_id,
                )
            ).first()
            if row is None:
                # Same exception/body as an unknown or foreign attempt. The
                # version need not be active, but must belong to this attempt.
                raise ExamAttemptNotFoundError("Exam attempt not found")
            pinned, version, grade, response = row

            options = (
                self._session.exec(
                    select(AnswerOption)
                    .where(AnswerOption.question_version_id == version.id)
                    .order_by(AnswerOption.position)
                ).all()
                if version.question_type == "multiple_choice"
                else []
            )
            if version.question_type == "multiple_choice" and not options:
                raise HistoricalReviewUnavailableError("Recorded options unavailable")

            images = self._session.exec(
                select(QuestionImage)
                .where(QuestionImage.question_version_id == version.id)
                .order_by(QuestionImage.position)
            ).all()
            correct_ids = [option.id for option in options if option.is_correct]

            return CompletedQuestionReviewOut(
                attempt_id=attempt.id,
                question_count=attempt.question_count,
                question_version_id=version.id,
                position=pinned.position,
                question_text=version.question_text,
                question_type=version.question_type,
                allows_multiple_answers=version.allows_multiple_answers,
                question_status=_review_status(version.question_type, grade, response),
                options=[
                    ExamOptionOut(
                        id=option.id,
                        position=option.position,
                        option_text=option.option_text,
                    )
                    for option in options
                ],
                images=[
                    ExamImageOut(
                        id=image.id,
                        position=image.position,
                        alt_text=image.alt_text,
                        media_type=image.media_type,
                        url=resolve_media_url(image.storage_key),
                    )
                    for image in images
                ],
                submitted_response=_submitted_response(
                    response, version.question_type, {option.id for option in options}
                ),
                correct_option_ids=correct_ids or None,
                explanation=_nonblank(version.explanation),
                grading=(
                    QuestionReviewGradeOut(
                        outcome=grade.outcome,
                        points_earned=grade.points_earned,
                        max_points=grade.max_points,
                        feedback=(
                            _nonblank(grade.feedback)
                            if grade.outcome == "manually_graded"
                            else None
                        ),
                    )
                    if grade is not None
                    else None
                ),
            )
