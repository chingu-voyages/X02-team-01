from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import get_current_subject
from app.repositories.in_memory import InMemoryQuestionRepository
from app.repositories.question_repository import QuestionRepository
from app.schemas.question import QuestionList
from app.services.question_service import get_eligible_questions

router = APIRouter()

# Swap this for the SQLModel-backed implementation once the store ticket's
# tables are available. The endpoint and service do not change.
_repository = InMemoryQuestionRepository()


def get_question_repository() -> QuestionRepository:
    """Provide the active question repository."""
    return _repository


@router.get("", response_model=QuestionList)
def list_questions(
    _subject: Annotated[str, Depends(get_current_subject)],
    repository: Annotated[QuestionRepository, Depends(get_question_repository)],
) -> QuestionList:
    """Return every practice question eligible for exam delivery."""
    return get_eligible_questions(repository)
