from dataclasses import dataclass, field
from typing import Protocol
from uuid import UUID


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
    both the in-memory stub and the SQLModel repository can produce it.
    """

    id: str
    question_id: str
    question_text: str
    question_type: str
    difficulty: str
    review_status: str
    publication_status: str
    is_flagged: bool
    allows_multiple_answers: bool = False
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


@dataclass(frozen=True)
class ExamQuestionSelection:
    """A question version selected for an exam attempt."""

    question_id: UUID
    question_version_id: UUID


class ExamQuestionSelector(Protocol):
    """Select eligible question versions for a certification."""

    def select_random_eligible(
        self,
        certification_id: UUID,
        question_count: int,
    ) -> list[ExamQuestionSelection]:
        """Return up to question_count randomized selections."""
        ...
