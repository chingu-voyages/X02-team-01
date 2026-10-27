"""API contracts for starting a randomized practice exam (JHEP-29)."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# Provisional safety cap; confirm the maximum exam size with product owners.
MAX_EXAM_QUESTIONS = 100


class ExamCreateRequest(BaseModel):
    """Client supplies certification and size, never learner identity."""

    model_config = ConfigDict(extra="forbid")

    certification_id: UUID
    question_count: Annotated[int, Field(strict=True, ge=1, le=MAX_EXAM_QUESTIONS)]


class ExamOptionOut(BaseModel):
    """A selectable option; does not expose its answer key."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    position: int
    option_text: str


class ExamQuestionOut(BaseModel):
    """Question version as assigned to the learner's attempt."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID  # Version ID, not the parent question ID
    position: int
    question_text: str
    question_type: Literal["multiple_choice", "short_answer"]
    allows_multiple_answers: bool
    difficulty: Literal["easy", "medium", "hard"]
    options: list[ExamOptionOut]


class ExamCreatedOut(BaseModel):
    """Return the persisted attempt and fixed randomized question order."""

    attempt_id: UUID
    certification_id: UUID
    status: Literal["in_progress"]
    question_count: int
    questions: list[ExamQuestionOut]
