"""Authenticated learner exam endpoints (JHEP-29/32/34/35).

Route surface:
- POST   /exams                                — start a randomized exam
- GET    /exams/{attempt_id}                   — resume saved state
- PATCH  /exams/{attempt_id}/progress          — persist navigation position
- PUT    /exams/{attempt_id}/responses/{v_id}  — save/clear one answer
- POST   /exams/{attempt_id}/responses/{v_id}/submit — lock + feedback
- POST   /exams/{attempt_id}/submit            — final submission + grading
- GET    /exams/{attempt_id}/results           — score + Pass/Fail

Absent and foreign attempts always answer with an identical 404 body so
attempt ids cannot be probed. Correctness data never leaves the backend
for an in-progress attempt before the mode permits it (AC4).
"""

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.api.deps import get_current_subject
from app.db.session import get_session
from app.schemas.exam import (
    ExamCreatedOut,
    ExamCreateRequest,
    ExamResumedOut,
    FinalSubmitOut,
    ProgressSavedOut,
    ProgressUpdateRequest,
    QuestionFeedbackOut,
    ResponseBlockOut,
    ResponseSavedOut,
    ResponseSaveRequest,
    ResultsOut,
)
from app.services.exam_attempt_service import (
    AttemptAlreadySubmittedError,
    AttemptNotGradableError,
    AttemptQuestionNotFoundError,
    ExamAttemptService,
    InvalidResponseContentError,
    NoAnswerContentError,
    QuestionAlreadyLockedError,
)
from app.services.exam_service import (
    CertificationNotFoundError,
    ExamAttemptNotFoundError,
    ExamService,
    InsufficientQuestionsError,
    InvalidQuestionCountError,
    LearnerNotFoundError,
    MissingThresholdError,
)
from app.services.grading_service import AttemptNotSubmittedError

router = APIRouter()


def get_exam_service(
    session: Annotated[Session, Depends(get_session)],
) -> ExamService:
    """Use the same request-scoped database session for the whole request."""
    return ExamService(session)


def get_exam_attempt_service(
    session: Annotated[Session, Depends(get_session)],
) -> ExamAttemptService:
    """Attempt lifecycle operations share the request's DB session."""
    return ExamAttemptService(session)


def _learner_id(subject: str) -> UUID:
    try:
        return UUID(subject)
    except (ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication subject",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


def _owned_attempt(
    attempt_id: UUID,
    learner_id: UUID,
    service: ExamService,
):
    try:
        return service.get_owned_attempt(
            attempt_id=attempt_id,
            learner_id=learner_id,
        )
    except ExamAttemptNotFoundError as exc:
        # Identical result for absent and foreign attempts.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Exam attempt not found",
        ) from exc


@router.post(
    "",
    response_model=ExamCreatedOut,
    response_model_exclude_none=True,
    status_code=status.HTTP_201_CREATED,
)
def create_exam(
    payload: ExamCreateRequest,
    subject: Annotated[str, Depends(get_current_subject)],
    service: Annotated[ExamService, Depends(get_exam_service)],
) -> ExamCreatedOut:
    """Generate, persist and deliver a new exam for the JWT-authenticated user."""
    learner_id = _learner_id(subject)

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
    except MissingThresholdError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Certification has no passing threshold configured",
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


@router.get(
    "/{attempt_id}",
    response_model=ExamResumedOut,
    response_model_exclude_none=True,
)
def get_exam_attempt(
    attempt_id: UUID,
    subject: Annotated[str, Depends(get_current_subject)],
    service: Annotated[ExamService, Depends(get_exam_service)],
    attempt_service: Annotated[ExamAttemptService, Depends(get_exam_attempt_service)],
) -> ExamResumedOut:
    """Restore a previously created attempt with its saved answers.

    Never load assigned content before verifying attempt ownership. Saved
    responses are echoed (screen 06); identities of absent and foreign
    attempts are identical.
    """
    learner_id = _learner_id(subject)
    attempt = _owned_attempt(attempt_id, learner_id, service)

    blocks = attempt_service.response_blocks(attempt)
    questions = service.get_exam_questions(attempt.id)
    for question in questions:
        block = blocks.pop(question.id, None)
        if block is not None:
            question.response = ResponseBlockOut(**block)

    return ExamResumedOut(
        attempt_id=attempt.id,
        certification_id=attempt.certification_id,
        status=attempt.status,
        question_count=attempt.question_count,
        current_position=attempt.current_position,
        questions=questions,
    )


@router.patch("/{attempt_id}/progress", response_model=ProgressSavedOut)
def update_progress(
    attempt_id: UUID,
    payload: ProgressUpdateRequest,
    subject: Annotated[str, Depends(get_current_subject)],
    service: Annotated[ExamService, Depends(get_exam_service)],
    attempt_service: Annotated[ExamAttemptService, Depends(get_exam_attempt_service)],
) -> ProgressSavedOut:
    """Persist the learner's current navigation position."""
    learner_id = _learner_id(subject)
    attempt = _owned_attempt(attempt_id, learner_id, service)

    try:
        attempt_service.apply_progress(attempt, payload.current_position)
    except AttemptAlreadySubmittedError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Attempt already submitted",
        ) from exc
    except InvalidResponseContentError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    answered, unanswered = attempt_service.answer_counts(attempt)
    return ProgressSavedOut(
        attempt_id=attempt.id,
        status=attempt.status,
        current_position=attempt.current_position,
        question_count=attempt.question_count,
        answered_count=answered,
        unanswered_count=unanswered,
    )


@router.put(
    "/{attempt_id}/responses/{question_version_id}",
    response_model=ResponseSavedOut,
    response_model_exclude_none=True,
)
def save_response(
    attempt_id: UUID,
    question_version_id: UUID,
    payload: ResponseSaveRequest,
    subject: Annotated[str, Depends(get_current_subject)],
    service: Annotated[ExamService, Depends(get_exam_service)],
    attempt_service: Annotated[ExamAttemptService, Depends(get_exam_attempt_service)],
) -> ResponseSavedOut:
    """Save, update or clear one question's answer (draft state only)."""
    learner_id = _learner_id(subject)
    attempt = _owned_attempt(attempt_id, learner_id, service)

    try:
        row = attempt_service.save_response(
            attempt,
            question_version_id,
            selected_option_ids=payload.selected_option_ids,
            text_response=payload.text_response,
        )
    except AttemptQuestionNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Exam attempt not found",
        ) from exc
    except AttemptAlreadySubmittedError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Attempt already submitted",
        ) from exc
    except QuestionAlreadyLockedError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Question already submitted",
        ) from exc
    except (NoAnswerContentError, InvalidResponseContentError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    answered, unanswered = attempt_service.answer_counts(attempt)
    if row is None:
        return ResponseSavedOut(
            attempt_id=attempt.id,
            question_version_id=question_version_id,
            selected_option_ids=None,
            text_response=None,
            is_submitted=False,
            answered_at=datetime.now(UTC),
            is_correct=None,
            question_count=attempt.question_count,
            answered_count=answered,
            unanswered_count=unanswered,
        )
    return ResponseSavedOut(
        attempt_id=attempt.id,
        question_version_id=row.question_version_id,
        selected_option_ids=[UUID(item) for item in row.selected_option_ids]
        if row.selected_option_ids
        else None,
        text_response=row.text_response,
        is_submitted=row.is_submitted,
        answered_at=row.answered_at,
        is_correct=row.is_correct,
        question_count=attempt.question_count,
        answered_count=answered,
        unanswered_count=unanswered,
    )


@router.post(
    "/{attempt_id}/responses/{question_version_id}/submit",
    response_model=QuestionFeedbackOut,
    response_model_exclude_none=True,
    status_code=status.HTTP_200_OK,
)
def submit_question(
    attempt_id: UUID,
    question_version_id: UUID,
    payload: ResponseSaveRequest,
    subject: Annotated[str, Depends(get_current_subject)],
    service: Annotated[ExamService, Depends(get_exam_service)],
    attempt_service: Annotated[ExamAttemptService, Depends(get_exam_attempt_service)],
) -> QuestionFeedbackOut:
    """Lock one question's answer; feedback depends on the attempt's mode.

    Immediate mode grades the question now and returns its verdict, the
    correct option ids and explanation; deferred mode confirms the lock
    and releases nothing until after final submission.
    """
    learner_id = _learner_id(subject)
    attempt = _owned_attempt(attempt_id, learner_id, service)

    try:
        feedback = attempt_service.submit_question(
            attempt,
            question_version_id,
            selected_option_ids=payload.selected_option_ids,
            text_response=payload.text_response,
        )
    except AttemptQuestionNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Exam attempt not found",
        ) from exc
    except AttemptAlreadySubmittedError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Attempt already submitted",
        ) from exc
    except QuestionAlreadyLockedError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Question already submitted",
        ) from exc
    except (NoAnswerContentError, InvalidResponseContentError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    return QuestionFeedbackOut(
        attempt_id=attempt.id,
        question_version_id=question_version_id,
        is_submitted=True,
        **feedback,
    )


@router.post("/{attempt_id}/submit", response_model=FinalSubmitOut)
def submit_exam(
    attempt_id: UUID,
    subject: Annotated[str, Depends(get_current_subject)],
    service: Annotated[ExamService, Depends(get_exam_service)],
    attempt_service: Annotated[ExamAttemptService, Depends(get_exam_attempt_service)],
) -> FinalSubmitOut:
    """Finalize the attempt and trigger grading exactly once.

    Duplicate submissions return 409 and never create duplicate grades or
    results; repeated result reads return the stored snapshot.
    """
    learner_id = _learner_id(subject)
    attempt = _owned_attempt(attempt_id, learner_id, service)

    try:
        attempt_service.final_submit(attempt)
    except AttemptAlreadySubmittedError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Attempt already submitted",
        ) from exc
    except AttemptNotGradableError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Attempt has no recorded passing threshold",
        ) from exc

    answered, unanswered = attempt_service.answer_counts(attempt)
    return FinalSubmitOut(
        attempt_id=attempt.id,
        status="submitted",
        question_count=attempt.question_count,
        answered_count=answered,
        unanswered_count=unanswered,
        submitted_at=attempt.submitted_at,
        results_url=f"/api/v1/exams/{attempt.id}/results",
    )


@router.get("/{attempt_id}/results", response_model=ResultsOut)
def get_results(
    attempt_id: UUID,
    subject: Annotated[str, Depends(get_current_subject)],
    service: Annotated[ExamService, Depends(get_exam_service)],
    attempt_service: Annotated[ExamAttemptService, Depends(get_exam_attempt_service)],
) -> ResultsOut:
    """Score for a submitted attempt; grades lazily on the first read.

    The persisted result and per-question rows are the single source of
    truth, so revisits return the identical snapshot. No answer keys or
    explanations are included — correctness aggregates only.
    """
    learner_id = _learner_id(subject)
    attempt = _owned_attempt(attempt_id, learner_id, service)

    try:
        payload = attempt_service.results_payload(attempt)
    except AttemptNotSubmittedError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Attempt has not been submitted",
        ) from exc

    return ResultsOut(**payload)
