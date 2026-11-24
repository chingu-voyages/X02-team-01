"""Administrator contracts for practice-exam publication (JHEP-126)."""

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class PracticeExamCreate(BaseModel):
    """Create a configured draft; JHEP-107 owns future count editing."""

    model_config = ConfigDict(extra="forbid")

    certification_id: UUID
    category_id: UUID
    name: str = Field(min_length=1, max_length=255)
    question_count: int | None = Field(default=None, strict=True, ge=1, le=100)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        name = value.strip()
        if not name:
            raise ValueError("Exam name must not be blank")
        return name


class PracticeExamPublicationUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    is_published: bool


class PracticeExamReadinessIssue(BaseModel):
    code: str
    message: str


class PracticeExamReadinessOut(BaseModel):
    ready: bool
    required_question_count: int | None
    eligible_question_count: int
    issues: list[PracticeExamReadinessIssue]


class AdminPracticeExamOut(BaseModel):
    id: UUID
    certification_id: UUID
    certification_name: str
    category_id: UUID
    category_name: str
    name: str
    question_count: int | None
    status: str
    readiness: PracticeExamReadinessOut


class AdminPracticeExamListOut(BaseModel):
    items: list[AdminPracticeExamOut]
    count: int
