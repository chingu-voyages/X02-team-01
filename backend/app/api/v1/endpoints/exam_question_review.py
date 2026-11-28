"""GET-only historical question review; never an alternate submission path."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlmodel import Session

from app.api.deps import get_authenticated_subject
from app.api.v1.endpoints.exams import _learner_id
from app.db.session import get_session
from app.schemas.exam_question_review import CompletedQuestionReviewOut
from app.services.exam_question_review_service import (
    ExamQuestionReviewService,
    HistoricalReviewUnavailableError,
)
from app.services.exam_service import ExamAttemptNotFoundError
from app.services.grading_service import AttemptNotSubmittedError

router = APIRouter()


def get_question_review_service(
    session: Annotated[Session, Depends(get_session)],
) -> ExamQuestionReviewService:
    return ExamQuestionReviewService(session)


@router.get(
    "/{attempt_id}/review/questions/{question_version_id}",
    response_model=CompletedQuestionReviewOut,
)
def read_completed_question(
    attempt_id: UUID,
    question_version_id: UUID,
    response: Response,
    subject: Annotated[str, Depends(get_authenticated_subject)],
    service: Annotated[ExamQuestionReviewService, Depends(get_question_review_service)],
) -> CompletedQuestionReviewOut:
    response.headers["Cache-Control"] = "no-store"
    learner_id = _learner_id(subject)
    try:
        return service.read(
            attempt_id=attempt_id,
            question_version_id=question_version_id,
            learner_id=learner_id,
        )
    except ExamAttemptNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Exam attempt not found",
            headers={"Cache-Control": "no-store"},
        ) from exc
    except AttemptNotSubmittedError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Complete this exam before reviewing its questions.",
            headers={"Cache-Control": "no-store"},
        ) from exc
    except HistoricalReviewUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "QUESTION_REVIEW_UNAVAILABLE",
                "message": "The recorded question review is unavailable.",
            },
            headers={"Cache-Control": "no-store"},
        ) from exc
