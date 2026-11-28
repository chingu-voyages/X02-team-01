"""Owner-only historical question detail (JHEP-72).

This contract is separate from the deliberately preview-only JHEP-37 list.
It reuses the existing option/image DTOs, not the editable question contract.
"""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.exam import ExamImageOut, ExamOptionOut
from app.schemas.exam_review import ReviewStatus


class SubmittedReviewResponseOut(BaseModel):
    """Only the recorded, submitted response; never an editable draft."""

    selected_option_ids: list[UUID] = Field(default_factory=list)
    text_response: str | None = None
    is_submitted: Literal[True] = True
    answered_at: datetime
    question_submitted_at: datetime | None = None


class QuestionReviewGradeOut(BaseModel):
    """Persisted learner-facing grading data, without grader identity."""

    outcome: Literal[
        "correct",
        "incorrect",
        "unanswered",
        "ungraded",
        "ungradable",
        "manually_graded",
    ]
    points_earned: Annotated[int, Field(ge=0)]
    max_points: Annotated[int | None, Field(ge=0)] = None
    feedback: str | None = None


class CompletedQuestionReviewOut(BaseModel):
    """An original pinned question, its submitted answer and released feedback.

    None for correct_option_ids means no multiple-choice answer key is
    available (including written questions); do not label it as an empty key.
    Overall correctness comes from question_status, not client-side scoring.
    """

    attempt_id: UUID
    attempt_status: Literal["submitted"] = "submitted"
    question_count: Annotated[int, Field(ge=1)]
    question_version_id: UUID
    position: Annotated[int, Field(ge=1)]
    question_text: str
    question_type: Literal["multiple_choice", "short_answer"]
    allows_multiple_answers: bool
    question_status: ReviewStatus
    options: list[ExamOptionOut] = Field(default_factory=list)
    images: list[ExamImageOut] = Field(default_factory=list)
    submitted_response: SubmittedReviewResponseOut | None = None
    correct_option_ids: list[UUID] | None = None
    explanation: str | None = None
    grading: QuestionReviewGradeOut | None = None
