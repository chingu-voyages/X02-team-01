"""Admin-only practice-exam configuration and publishing endpoints."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.api.deps import require_administrator
from app.db.session import get_session
from app.schemas.admin_practice_exam import (
    AdminPracticeExamListOut,
    AdminPracticeExamOut,
    PracticeExamConfigurationUpdate,
    PracticeExamCreate,
    PracticeExamPublicationUpdate,
    PracticeExamReadinessOut,
)
from app.services.admin_practice_exam_service import (
    PracticeExamNameConflictError,
    PracticeExamNotEditableError,
    PracticeExamNotFoundError,
    PracticeExamNotReadyError,
    PracticeExamScopeError,
    create_practice_exam,
    get_practice_exam,
    list_practice_exams,
    set_practice_exam_publication,
    update_practice_exam,
)

router = APIRouter(dependencies=[Depends(require_administrator)])


def _out(record) -> AdminPracticeExamOut:
    return AdminPracticeExamOut.model_validate(record, from_attributes=True)


@router.get("", response_model=AdminPracticeExamListOut)
def list_managed_practice_exams(
    session: Annotated[Session, Depends(get_session)],
) -> AdminPracticeExamListOut:
    exams = list_practice_exams(session)
    return AdminPracticeExamListOut(
        items=[_out(exam) for exam in exams], count=len(exams)
    )


@router.post(
    "", response_model=AdminPracticeExamOut, status_code=status.HTTP_201_CREATED
)
def create_managed_practice_exam(
    payload: PracticeExamCreate,
    session: Annotated[Session, Depends(get_session)],
) -> AdminPracticeExamOut:
    try:
        record = create_practice_exam(session, payload)
    except PracticeExamScopeError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PracticeExamNameConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _out(record)


@router.get("/{exam_id}", response_model=AdminPracticeExamOut)
def get_managed_practice_exam(
    exam_id: UUID,
    session: Annotated[Session, Depends(get_session)],
) -> AdminPracticeExamOut:
    try:
        return _out(get_practice_exam(session, exam_id))
    except PracticeExamNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/{exam_id}", response_model=AdminPracticeExamOut)
def update_managed_practice_exam(
    exam_id: UUID,
    payload: PracticeExamConfigurationUpdate,
    session: Annotated[Session, Depends(get_session)],
) -> AdminPracticeExamOut:
    try:
        updated = update_practice_exam(session, exam_id, payload)
    except (PracticeExamNotFoundError, PracticeExamScopeError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (PracticeExamNotEditableError, PracticeExamNameConflictError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _out(updated)


@router.patch("/{exam_id}/publication", response_model=AdminPracticeExamOut)
def update_practice_exam_publication(
    exam_id: UUID,
    payload: PracticeExamPublicationUpdate,
    session: Annotated[Session, Depends(get_session)],
) -> AdminPracticeExamOut:
    try:
        updated = set_practice_exam_publication(
            session, exam_id, is_published=payload.is_published
        )
    except PracticeExamNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PracticeExamNotReadyError as exc:
        details = PracticeExamReadinessOut.model_validate(
            exc.readiness, from_attributes=True
        )
        raise HTTPException(
            status_code=409,
            detail={
                "code": "PRACTICE_EXAM_NOT_READY",
                "message": "Resolve the listed issues before publishing this exam.",
                "readiness": details.model_dump(mode="json"),
            },
        ) from exc
    return _out(updated)
