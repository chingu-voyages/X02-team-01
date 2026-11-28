"""Admin/Contributor manual-grading endpoints (JHEP-122).

Every route resolves the caller from the database on each request and
calls JHEP-192's `can_grade_response_type` for the response type, so
viewing, grading, and history access are all denied safely (AC2/AC3).
"""

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session

from app.api.deps import require_contributor_or_administrator
from app.db.session import get_session
from app.models import User
from app.schemas.manual_grading import (
    GradeHistoryOutList,
    GradingPermissionsOut,
    ManualGradeQueueOut,
    ManualGradeSubmitIn,
    ManualGradeSubmitOut,
    ResponseDetailOut,
)
from app.services.admin_user_service import can_grade_response_type
from app.services.manual_grading_service import (
    GradingPermissionDeniedError,
    InvalidScoreError,
    ResponseNotFoundError,
    ResponseNotGradableError,
    pending_responses,
    response_detail,
    submit_final_grade,
)

router = APIRouter(
    dependencies=[Depends(require_contributor_or_administrator)],
)


def _error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message},
    )


def _denied() -> HTTPException:
    return _error(
        status.HTTP_403_FORBIDDEN,
        "GRADING_PERMISSION_DENIED",
        "You do not have permission to review this response type",
    )


@router.get("/grading/permissions", response_model=GradingPermissionsOut)
def own_grading_permissions(
    actor: Annotated[User, Depends(require_contributor_or_administrator)],
) -> GradingPermissionsOut:
    """The caller's own permitted types for the queue filter (AC2/AC3)."""
    return GradingPermissionsOut(
        short_answer=can_grade_response_type(actor, "short_answer"),
        essay=can_grade_response_type(actor, "essay"),
    )


@router.get("/grading/pending", response_model=ManualGradeQueueOut)
def pending_manual_responses(
    actor: Annotated[User, Depends(require_contributor_or_administrator)],
    session: Annotated[Session, Depends(get_session)],
    response_type: Annotated[Literal["short_answer", "essay"] | None, Query()] = None,
) -> ManualGradeQueueOut:
    """Submitted written responses without a final grade (AC1)."""
    if response_type is not None and not can_grade_response_type(actor, response_type):
        raise _denied()

    items = pending_responses(session, actor=actor, response_type=response_type)
    return ManualGradeQueueOut(items=items, count=len(items))


@router.get(
    "/grading/responses/{attempt_id}/{question_version_id}",
    response_model=ResponseDetailOut,
)
def written_response_detail(
    attempt_id: UUID,
    question_version_id: UUID,
    actor: Annotated[User, Depends(require_contributor_or_administrator)],
    session: Annotated[Session, Depends(get_session)],
) -> ResponseDetailOut:
    """Saved response, pinned version, rubric and history (AC1/AC3)."""
    try:
        return response_detail(
            session,
            actor=actor,
            attempt_id=attempt_id,
            question_version_id=question_version_id,
        )
    except GradingPermissionDeniedError as exc:
        raise _denied() from exc
    except ResponseNotFoundError as exc:
        raise _error(status.HTTP_404_NOT_FOUND, "RESPONSE_NOT_FOUND", str(exc)) from exc


@router.get(
    "/grading/responses/{attempt_id}/{question_version_id}/history",
    response_model=GradeHistoryOutList,
)
def written_response_history(
    attempt_id: UUID,
    question_version_id: UUID,
    actor: Annotated[User, Depends(require_contributor_or_administrator)],
    session: Annotated[Session, Depends(get_session)],
) -> GradeHistoryOutList:
    """The preserved grading actions, behind the same per-type gate (AC5)."""
    try:
        detail = response_detail(
            session,
            actor=actor,
            attempt_id=attempt_id,
            question_version_id=question_version_id,
        )
    except GradingPermissionDeniedError as exc:
        raise _denied() from exc
    except ResponseNotFoundError as exc:
        raise _error(status.HTTP_404_NOT_FOUND, "RESPONSE_NOT_FOUND", str(exc)) from exc
    return GradeHistoryOutList(items=detail["history"], count=len(detail["history"]))


@router.post(
    "/grading/responses/{attempt_id}/{question_version_id}/grade",
    response_model=ManualGradeSubmitOut,
)
def submit_written_response_grade(
    attempt_id: UUID,
    question_version_id: UUID,
    payload: ManualGradeSubmitIn,
    actor: Annotated[User, Depends(require_contributor_or_administrator)],
    session: Annotated[Session, Depends(get_session)],
) -> ManualGradeSubmitOut:
    """Record one human final grade or an authorized revision (AC4/AC5)."""
    try:
        return submit_final_grade(
            session,
            actor=actor,
            attempt_id=attempt_id,
            question_version_id=question_version_id,
            score=payload.score,
            feedback=payload.feedback,
        )
    except GradingPermissionDeniedError as exc:
        raise _denied() from exc
    except InvalidScoreError as exc:
        raise _error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "INVALID_SCORE", str(exc)
        ) from exc
    except ResponseNotGradableError as exc:
        raise _error(
            status.HTTP_409_CONFLICT, "RESPONSE_NOT_GRADABLE", str(exc)
        ) from exc
    except ResponseNotFoundError as exc:
        raise _error(status.HTTP_404_NOT_FOUND, "RESPONSE_NOT_FOUND", str(exc)) from exc
