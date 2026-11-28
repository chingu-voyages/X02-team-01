"""Authenticated, availability-gated practice exam catalog (JHEP-126)."""

import logging
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session

from app.api.deps import get_authenticated_subject
from app.db.session import get_session
from app.repositories.practice_exam_catalog_repository import (
    SQLModelPracticeExamCatalogRepository,
)
from app.repositories.unfinished_exam_repository import list_unfinished_exams
from app.schemas.learner_practice_exam import (
    PublishedPracticeExamListOut,
    PublishedPracticeExamOut,
)
from app.schemas.unfinished_exam import UnfinishedExamListOut

logger = logging.getLogger(__name__)
router = APIRouter()


def get_practice_exam_catalog_repository(
    session: Annotated[Session, Depends(get_session)],
) -> SQLModelPracticeExamCatalogRepository:
    return SQLModelPracticeExamCatalogRepository(session)


@router.get("/catalog", response_model=PublishedPracticeExamListOut)
def list_published_practice_exams(
    _subject: Annotated[str, Depends(get_authenticated_subject)],
    repository: Annotated[
        SQLModelPracticeExamCatalogRepository,
        Depends(get_practice_exam_catalog_repository),
    ],
) -> PublishedPracticeExamListOut:
    """Empty catalog means no currently startable published practice exams."""
    try:
        exams = repository.list_available()
    except SQLAlchemyError as exc:
        logger.exception("Unable to load the learner practice exam catalog")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Practice exams are temporarily unavailable",
        ) from exc

    return PublishedPracticeExamListOut(
        exams=[
            PublishedPracticeExamOut.model_validate(exam, from_attributes=True)
            for exam in exams
        ]
    )


@router.get("/unfinished", response_model=UnfinishedExamListOut)
def list_own_unfinished_exams(
    response: Response,
    subject: Annotated[str, Depends(get_authenticated_subject)],
    session: Annotated[Session, Depends(get_session)],
) -> UnfinishedExamListOut:
    """Recover existing attempts independently of current publication status."""
    response.headers["Cache-Control"] = "no-store"
    try:
        attempts = list_unfinished_exams(session, UUID(subject))
    except SQLAlchemyError as exc:
        logger.exception("Unable to load unfinished exams")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unfinished exams are temporarily unavailable",
        ) from exc
    return UnfinishedExamListOut(attempts=attempts)
