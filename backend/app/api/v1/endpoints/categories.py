"""Authenticated learner category catalog endpoints (JHEP-27)."""

import logging
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session

from app.api.deps import get_current_subject
from app.db.session import get_session
from app.repositories.category_repository import SQLModelCategoryRepository
from app.schemas.category import CategoryListOut, CategoryOut

logger = logging.getLogger(__name__)

router = APIRouter()


def get_category_repository(
    session: Annotated[Session, Depends(get_session)],
) -> SQLModelCategoryRepository:
    """Provide the PostgreSQL-backed read-only category catalog."""
    return SQLModelCategoryRepository(session)


@router.get("", response_model=CategoryListOut)
def list_categories(
    _subject: Annotated[str, Depends(get_current_subject)],
    repository: Annotated[
        SQLModelCategoryRepository,
        Depends(get_category_repository),
    ],
    certification_id: UUID | None = None,
) -> CategoryListOut:
    """Return practice categories currently available to learners.

    An empty catalog is a successful response. Database failures are reported
    separately so the frontend can distinguish "nothing available" from
    "could not load categories".
    """
    try:
        categories = repository.list_available(certification_id=certification_id)
    except SQLAlchemyError as exc:
        logger.exception("Failed to load available practice exam categories")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Practice exam categories are temporarily unavailable",
        ) from exc

    return CategoryListOut(
        categories=[
            CategoryOut(
                id=category.id,
                certification_id=category.certification_id,
                name=category.name,
                certification_name=category.certification_name,
                available_question_count=category.available_question_count,
            )
            for category in categories
        ]
    )
