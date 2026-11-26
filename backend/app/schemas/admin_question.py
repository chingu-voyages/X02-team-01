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


class RubricCriterionInput(BaseModel):
    """One scoring criterion of a written question's rubric (JHEP-121)."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(
        min_length=1,
        max_length=200,
    )

    points: int = Field(
        ge=1,
        le=1000,
    )

    @field_validator("name")
    @classmethod
    def normalize_name(
        cls,
        value: str,
    ) -> str:
        normalized = value.strip()

        if not normalized:
            raise ValueError("criterion name must not be blank")

        return normalized


class _QuestionDraftContent(BaseModel):
    """Fields shared by create and edit payloads."""

    model_config = ConfigDict(extra="forbid")

    question_text: str

    question_type: Literal[
        "multiple_choice",
        "short_answer",
        "essay",
    ]

    allows_multiple_answers: bool = False
    explanation: str | None = None

    options: list[AdminAnswerOptionInput] = Field(default_factory=list)

    expected_answer: str | None = None

    # JHEP-121: the model answer rides in expected_answer; the scoring
    # rubric is an ordered criterion list. `max_points` is the consistent
    # total: when provided it must equal the sum of the criterion points,
    # otherwise it defaults to the sum. Omitting `rubric` on a short_answer
    # draft derives the permitted one-criterion default ("Correct
    # response", 1 point) so existing behaviour is preserved.
    rubric: list[RubricCriterionInput] | None = None

    max_points: int | None = Field(
        default=None,
        ge=1,
        le=5000,
    )

    # Original Markdown authoring text for the scoring criteria (essay
    # rubrics in particular). Raw Markdown — never rendered unsanitized.
    criteria_markdown: str | None = None

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

    @field_validator("criteria_markdown")
    @classmethod
    def normalize_criteria_markdown(
        cls,
        value: str | None,
    ) -> str | None:
        if value is None:
            return None

        normalized = value.strip()

        return normalized or None

    @field_validator("rubric")
    @classmethod
    def validate_rubric_criteria(
        cls,
        value: list[RubricCriterionInput] | None,
    ) -> list[RubricCriterionInput] | None:
        if value is None:
            return None

        if len(value) > 20:
            raise ValueError("a rubric may define at most 20 criteria")

        names = [criterion.name.lower() for criterion in value]

        if len(names) != len(set(names)):
            raise ValueError("rubric criterion names must be unique")

        return value

    @model_validator(mode="after")
    def validate_answer_configuration(
        self,
    ):
        if self.question_type == "multiple_choice":
            if self.expected_answer is not None:
                raise ValueError(
                    "multiple_choice questions cannot define expected_answer"
                )

            if self.rubric is not None:
                raise ValueError("multiple_choice questions cannot define a rubric")

            if self.criteria_markdown is not None:
                raise ValueError(
                    "multiple_choice questions cannot define criteria_markdown"
                )

            if self.max_points is not None:
                raise ValueError("multiple_choice questions cannot define max_points")

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
            raise ValueError("written questions cannot allow multiple answers")

        if self.options:
            raise ValueError("written questions cannot define answer options")

        if self.expected_answer is None:
            raise ValueError(f"{self.question_type} questions require expected_answer")

        if self.question_type == "essay" and self.rubric is None:
            raise ValueError("essay questions require a rubric")

        if self.rubric is not None and len(self.rubric) < 1:
            raise ValueError("a rubric requires at least one criterion")

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
        "essay",
    ]

    review_status: Literal[
        "pending",
        "submitted",
        "in_review",
        "approved",
        "rejected",
    ]

    publication_status: Literal[
        "draft",
        "active",
        "inactive",
        "retired",
    ]

    review_note: str | None = None

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


class RubricCriterionOut(BaseModel):
    """Rubric criterion visible only in management/grading routes."""

    position: int
    name: str
    points: int


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
        "essay",
    ]

    allows_multiple_answers: bool
    explanation: str | None

    review_status: Literal[
        "pending",
        "submitted",
        "in_review",
        "approved",
        "rejected",
    ]

    publication_status: Literal[
        "draft",
        "active",
        "inactive",
        "retired",
    ]

    review_note: str | None = None

    is_flagged: bool

    created_by_id: UUID
    submitted_by_id: UUID

    last_updated: datetime

    options: list[AdminAnswerOptionOut] = Field(default_factory=list)

    expected_answer: str | None = None

    max_points: int | None = None

    criteria_markdown: str | None = None

    rubric: list[RubricCriterionOut] = Field(default_factory=list)

    images: list[AdminQuestionImageOut] = Field(default_factory=list)
