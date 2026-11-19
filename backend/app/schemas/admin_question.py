from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)


class AdminAnswerOptionInput(BaseModel):
    """Answer option accepted from an authorized question editor."""

    model_config = ConfigDict(extra="forbid")

    option_text: str
    is_correct: bool = False

    @field_validator("option_text")
    @classmethod
    def normalize_option_text(
        cls,
        value: str,
    ) -> str:
        normalized = value.strip()

        if not normalized:
            raise ValueError("option_text must not be blank")

        return normalized


class _QuestionDraftContent(BaseModel):
    """Fields shared by create and edit payloads."""

    model_config = ConfigDict(extra="forbid")

    question_text: str

    question_type: Literal[
        "multiple_choice",
        "short_answer",
    ]

    allows_multiple_answers: bool = False
    explanation: str | None = None

    options: list[AdminAnswerOptionInput] = Field(default_factory=list)

    expected_answer: str | None = None

    @field_validator("question_text")
    @classmethod
    def normalize_question_text(
        cls,
        value: str,
    ) -> str:
        normalized = value.strip()

        if not normalized:
            raise ValueError("question_text must not be blank")

        return normalized

    @field_validator("explanation")
    @classmethod
    def normalize_explanation(
        cls,
        value: str | None,
    ) -> str | None:
        if value is None:
            return None

        normalized = value.strip()

        return normalized or None

    @field_validator("expected_answer")
    @classmethod
    def normalize_expected_answer(
        cls,
        value: str | None,
    ) -> str | None:
        if value is None:
            return None

        normalized = value.strip()

        return normalized or None

    @model_validator(mode="after")
    def validate_answer_configuration(
        self,
    ):
        if self.question_type == "multiple_choice":
            if self.expected_answer is not None:
                raise ValueError(
                    "multiple_choice questions cannot define expected_answer"
                )

            if len(self.options) < 2:
                raise ValueError(
                    "multiple_choice questions require at least two options"
                )

            correct_count = sum(option.is_correct for option in self.options)

            if correct_count < 1:
                raise ValueError(
                    "multiple_choice questions require at least one correct option"
                )

            if not self.allows_multiple_answers and correct_count != 1:
                raise ValueError(
                    "single-select questions require exactly one correct option"
                )

            return self

        if self.allows_multiple_answers:
            raise ValueError("short_answer questions cannot allow multiple answers")

        if self.options:
            raise ValueError("short_answer questions cannot define answer options")

        if self.expected_answer is None:
            raise ValueError("short_answer questions require expected_answer")

        return self


class QuestionDraftCreate(_QuestionDraftContent):
    """Create version 1 in pending/draft state."""

    certification_id: UUID
    category_id: UUID | None = None

    difficulty: Literal[
        "easy",
        "medium",
        "hard",
    ]


class QuestionDraftEdit(_QuestionDraftContent):
    """Replace editable fields of an existing draft."""

    category_id: UUID | None = None

    difficulty: Literal[
        "easy",
        "medium",
        "hard",
    ]


class QuestionRejectionRequest(BaseModel):
    """Administrator review feedback for a rejection."""

    model_config = ConfigDict(extra="forbid")

    review_note: str = Field(
        min_length=1,
        max_length=2000,
    )

    @field_validator("review_note")
    @classmethod
    def normalize_review_note(
        cls,
        value: str,
    ) -> str:
        normalized = value.strip()

        if not normalized:
            raise ValueError("review_note must not be blank")

        return normalized


class QuestionDraftCreated(BaseModel):
    """Server-controlled response after a draft is persisted."""

    question_id: UUID
    question_version_id: UUID
    version_number: int

    review_status: Literal["pending"]

    publication_status: Literal["draft"]


class QuestionBankItem(BaseModel):
    """Question-bank row built from the latest stored version."""

    question_id: UUID
    question_version_id: UUID
    version_number: int

    question_preview: str

    certification_id: UUID
    certification_name: str

    category_id: UUID | None
    category_name: str | None

    difficulty: Literal[
        "easy",
        "medium",
        "hard",
    ]

    question_type: Literal[
        "multiple_choice",
        "short_answer",
    ]

    review_status: Literal[
        "pending",
        "approved",
        "rejected",
    ]

    publication_status: Literal[
        "draft",
        "active",
        "retired",
    ]

    is_flagged: bool
    has_image: bool = False

    created_by_id: UUID
    last_updated: datetime


class QuestionBankList(BaseModel):
    """Role-filtered question bank."""

    items: list[QuestionBankItem]

    count: int


class AdminAnswerOptionOut(BaseModel):
    """Trusted answer option visible only in management routes."""

    position: int
    option_text: str
    is_correct: bool


class AdminQuestionImageOut(BaseModel):
    """Safe image metadata returned to authorized managers."""

    id: UUID
    question_version_id: UUID
    position: int
    alt_text: str

    media_type: Literal[
        "image/png",
        "image/jpeg",
        "image/webp",
    ]

    url: str | None = None


class QuestionBankDetail(BaseModel):
    """Latest-version management detail."""

    question_id: UUID
    question_version_id: UUID
    version_number: int

    certification_id: UUID
    certification_name: str

    category_id: UUID | None
    category_name: str | None

    difficulty: Literal[
        "easy",
        "medium",
        "hard",
    ]

    question_text: str

    question_type: Literal[
        "multiple_choice",
        "short_answer",
    ]

    allows_multiple_answers: bool
    explanation: str | None

    review_status: Literal[
        "pending",
        "approved",
        "rejected",
    ]

    publication_status: Literal[
        "draft",
        "active",
        "retired",
    ]

    is_flagged: bool

    created_by_id: UUID
    submitted_by_id: UUID

    last_updated: datetime

    options: list[AdminAnswerOptionOut] = Field(default_factory=list)

    expected_answer: str | None = None

    images: list[AdminQuestionImageOut] = Field(default_factory=list)
