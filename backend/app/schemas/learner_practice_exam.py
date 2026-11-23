"""Safe learner catalog contracts: no answer keys or draft exam records."""

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class PublishedPracticeExamOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    certification_id: UUID
    certification_name: str
    category_id: UUID
    category_name: str
    name: str
    question_count: int = Field(ge=1, le=100)
    available_question_count: int = Field(ge=1)


class PublishedPracticeExamListOut(BaseModel):
    exams: list[PublishedPracticeExamOut] = Field(default_factory=list)
