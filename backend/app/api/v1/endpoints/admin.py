"""Role-protected administrative API routes."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.api.deps import get_current_user, require_contributor_or_administrator
from app.db.session import get_session
from app.models.user import User
from app.schemas.admin_question import QuestionDraftCreate, QuestionDraftCreated
from app.services.admin_question_service import (
    QuestionDraftScopeError,
    create_question_draft,
)

router = APIRouter(
    dependencies=[Depends(require_contributor_or_administrator)],
)


@router.post(
    "/questions",
    response_model=QuestionDraftCreated,
    status_code=status.HTTP_201_CREATED,
)
def create_draft_question(
    payload: QuestionDraftCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> QuestionDraftCreated:
    """Create version 1 of a question in pending/draft state."""
    try:
        created = create_question_draft(
            session,
            payload,
            actor_id=current_user.id,
        )
    except QuestionDraftScopeError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc

    return QuestionDraftCreated(
        question_id=created.question_id,
        question_version_id=created.question_version_id,
        version_number=created.version_number,
        review_status=created.review_status,
        publication_status=created.publication_status,
    )
