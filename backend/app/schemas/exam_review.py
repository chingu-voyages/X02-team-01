"""Preview-only contract for a completed attempt (JHEP-37)."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel

ReviewStatus = Literal[
    "correct",
    "incorrect",
    "unanswered",
    "pending_manual_grading",
    "manually_graded",
    "unavailable",
]


class ReviewQuestionOut(BaseModel):
    """One pinned question; never includes answers or explanations."""

    question_version_id: UUID
    position: int
    preview: str
    status: ReviewStatus


class CompletedExamReviewOut(BaseModel):
    attempt_id: UUID
    status: Literal["submitted"]
    question_count: int
    questions: list[ReviewQuestionOut]
