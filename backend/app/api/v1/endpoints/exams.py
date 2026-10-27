"""Authenticated endpoint to generate a new randomized practice exam."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.api.deps import get_current_subject
from app.db.session import get_session
from app.schemas.exam import ExamCreatedOut, ExamCreateRequest
from app.services.exam_service import (
    CertificationNotFoundError,
    ExamService,
    InsufficientQuestionsError,
    InvalidQuestionCountError,
    LearnerNotFoundError,
)

router = APIRouter()


def get_exam_service(
    session: Annotated[Session, Depends(get_session)],
) -> ExamService:
    """Use the same request-scoped database session for the whole request."""
    return ExamService(session)


@router.post("", response_model=ExamCreatedOut, status_code=status.HTTP_201_CREATED)
def create_exam(
    payload: ExamCreateRequest,
    subject: Annotated[str, Depends(get_current_subject)],
    service: Annotated[ExamService, Depends(get_exam_service)],
) -> ExamCreatedOut:
    """Generate, persist and deliver a new exam for the JWT-authenticated user."""
    try:
        learner_id = UUID(subject)
    except (ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication subject",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    try:
        created = service.create_exam(
            learner_id=learner_id,
            certification_id=payload.certification_id,
            question_count=payload.question_count,
        )
    except LearnerNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authenticated learner not found",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except CertificationNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Certification not found",
        ) from exc
    except InsufficientQuestionsError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "INSUFFICIENT_QUESTIONS",
                "requested": exc.requested,
                "available": exc.available,
            },
        ) from exc
    except InvalidQuestionCountError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    # Creation has already committed; read the recorded assignment order.
    # The service deliberately loads only public question and option columns.
    questions = service.get_exam_questions(created.attempt_id)
    return ExamCreatedOut(
        attempt_id=created.attempt_id,
        certification_id=created.certification_id,
        status="in_progress",
        question_count=created.question_count,
        questions=questions,
    )
