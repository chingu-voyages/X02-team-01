from typing import Annotated

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.api.deps import get_current_subject
from app.db.session import get_session
from app.repositories.question_repository import QuestionRepository
from app.repositories.sqlmodel_repository import SQLModelQuestionRepository
from app.schemas.question import QuestionList
from app.services.question_service import get_eligible_questions

router = APIRouter()


def get_question_repository(
    session: Annotated[Session, Depends(get_session)],
) -> QuestionRepository:
    """Provide the PostgreSQL-backed question repository."""
    return SQLModelQuestionRepository(session)


@router.get("", response_model=QuestionList)
def list_questions(
    _subject: Annotated[str, Depends(get_current_subject)],
    repository: Annotated[QuestionRepository, Depends(get_question_repository)],
) -> QuestionList:
    """Return every practice question eligible for exam delivery."""
    return get_eligible_questions(repository)
