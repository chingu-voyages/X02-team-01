from dataclasses import dataclass, field
from typing import Protocol


@dataclass(frozen=True)
class QuestionOption:
    """A single selectable option belonging to a multiple-choice question."""

    position: int
    option_text: str
    is_correct: bool


@dataclass(frozen=True)
class Question:
    """A question version as the delivery layer sees it.

    Deliberately a plain data object: it carries no database metadata so that
    both the in-memory stub and a future SQLModel repository can produce it.
    """

    id: str
    question_id: str
    question_text: str
    question_type: str
    difficulty: str
    review_status: str
    publication_status: str
    is_flagged: bool
    options: list[QuestionOption] = field(default_factory=list)
    expected_answer: str | None = None


class QuestionRepository(Protocol):
    """Source of question versions eligible for exam delivery.

    Implementations qualify structurally: any class exposing a matching
    ``list_eligible`` method satisfies this protocol without inheriting.
    """

    def list_eligible(self) -> list[Question]:
        """Return only approved, active and unflagged questions."""
        ...
