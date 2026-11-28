from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class AttemptByExamOut(BaseModel):
    """One Completed-Attempts-by-Exam table row (JHEP-115 AC6)."""

    exam_id: UUID | None
    title: str
    count: int


class DashboardOverviewOut(BaseModel):
    """The whole Administrator overview payload (JHEP-115)."""

    registered_learners: int

    completed_attempts: int
    participating_learners: int

    pending_question_reviews: int
    review_breakdown: dict[Literal["submitted", "in_review"], int]

    attempts_by_exam: list[AttemptByExamOut]

    filters: dict

    generated_at: datetime
