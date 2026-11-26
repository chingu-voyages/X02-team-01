"""Manual grading payloads for written responses (JHEP-122).

These models carry only reviewer-facing data: the learner's saved
response, the pinned version and its answer key/rubric ceiling, the
current grade, and the human-action history. Answer options and
correctness keys for multiple-choice questions never appear here.
"""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

ResponseType = Literal["short_answer", "essay"]


class GradingPermissionsOut(BaseModel):
    """The caller's own JHEP-192 permissions (the queue's filter)."""

    short_answer: bool
    essay: bool


class PendingResponseOut(BaseModel):
    """One submitted written response awaiting a final human grade."""

    attempt_id: UUID
    question_version_id: UUID
    response_type: ResponseType
    learner_email: str | None
    learner_name: str | None
    question_preview: str
    submitted_at: datetime | None
    max_points: int


class ManualGradeQueueOut(BaseModel):
    """The pending-review queue, filtered to permitted response types."""

    items: list[PendingResponseOut]
    count: int


class CurrentGradeOut(BaseModel):
    """The live grade row (one latest final grade counts — AC8)."""

    outcome: str | None
    points_earned: int | None
    feedback: str | None
    graded_by_id: UUID | None
    grader_role: str | None
    max_points: int | None
    graded_at: datetime | None


class GradeHistoryOut(BaseModel):
    """One preserved grading action (graded or revised — AC5)."""

    grader_role: str
    action: Literal["graded", "revised"]
    score: int
    max_points: int
    feedback: str | None
    created_at: datetime


class ProvisionalFeedbackOut(BaseModel):
    """JHEP-182/194 seam: labelled context, never a final grade (AC6)."""

    available: bool
    label: str
    content: str | None


class ResponseDetailOut(BaseModel):
    """Review detail: saved response, pinned version, rubric, and history."""

    attempt_id: UUID
    question_version_id: UUID
    response_type: ResponseType
    question_text: str
    learner_response: str
    expected_answer: str | None
    max_points: int
    current_grade: CurrentGradeOut | None
    history: list[GradeHistoryOut]
    provisional_ai_feedback: ProvisionalFeedbackOut


class GradeHistoryOutList(BaseModel):
    """History alone, for the dedicated permission-gated history route."""

    items: list[GradeHistoryOut]
    count: int


class ManualGradeSubmitIn(BaseModel):
    """A human's explicit final score and optional feedback (AC4/AC6)."""

    model_config = ConfigDict(extra="forbid")

    score: int = Field(ge=0)
    feedback: str | None = Field(default=None, max_length=5000)


class ManualGradeSubmitOut(BaseModel):
    """The applied grade and whether it was a first grade or a revision."""

    attempt_id: UUID
    question_version_id: UUID
    outcome: Literal["manually_graded"]
    score: int
    max_points: int
    feedback: str | None
    grader_role: str
    action: Literal["graded", "revised"]
