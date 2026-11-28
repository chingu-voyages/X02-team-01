"""Learner-owned attempt summaries; no question content or answer keys."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class UnfinishedExamOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    attempt_id: UUID
    practice_exam_id: UUID | None
    certification_name: str
    category_name: str | None
    name: str | None
    question_count: int = Field(ge=1)
    submitted_count: int = Field(ge=0)
    current_position: int = Field(ge=1)
    started_at: datetime


class UnfinishedExamListOut(BaseModel):
    attempts: list[UnfinishedExamOut] = Field(default_factory=list)
