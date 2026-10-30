"""API contracts for starting a randomized practice exam (JHEP-29)."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# Provisional safety cap; confirm the maximum exam size with product owners.
MAX_EXAM_QUESTIONS = 100
MAX_SELECTED_OPTIONS = 10
MAX_TEXT_ANSWER_LENGTH = 10_000


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


class ExamImageOut(BaseModel):
    """Version-associated image, with an optional CDN delivery URL."""

    id: UUID
    position: int
    alt_text: str
    media_type: Literal["image/png", "image/jpeg", "image/webp"]
    url: str | None = None


class ResponseBlockOut(BaseModel):
    """Saved answer echoed on the resume screen (screen 06).

    `is_correct` is only populated after submission or in immediate
    feedback mode; it stays absent otherwise.
    """

    question_version_id: UUID
    selected_option_ids: list[UUID] | None = None
    text_response: str | None = None
    is_submitted: bool
    answered_at: datetime
    is_correct: bool | None = None


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
    images: list[ExamImageOut] = Field(default_factory=list)
    response: ResponseBlockOut | None = None


class ExamCreatedOut(BaseModel):
    """Return the persisted attempt and fixed randomized question order."""

    attempt_id: UUID
    certification_id: UUID
    status: Literal["in_progress"]
    question_count: int
    questions: list[ExamQuestionOut]


class ExamResumedOut(BaseModel):
    """Existing attempt in its originally persisted question order."""

    attempt_id: UUID
    certification_id: UUID
    status: Literal["in_progress", "submitted"]
    question_count: int
    current_position: int
    questions: list[ExamQuestionOut]


# ----------------------------------------------------------------------
# JHEP-32: saved responses, navigation, resume
# ----------------------------------------------------------------------


class ResponseSaveRequest(BaseModel):
    """One question's answer; exactly one content channel per question type."""

    model_config = ConfigDict(extra="forbid")

    selected_option_ids: Annotated[
        list[UUID] | None, Field(max_length=MAX_SELECTED_OPTIONS)
    ] = None
    text_response: Annotated[str | None, Field(max_length=MAX_TEXT_ANSWER_LENGTH)] = (
        None
    )


class ResponseSavedOut(BaseModel):
    """Confirmation for a saved (or cleared) answer."""

    attempt_id: UUID
    question_version_id: UUID
    selected_option_ids: list[UUID] | None
    text_response: str | None
    is_submitted: bool
    answered_at: datetime
    is_correct: bool | None = None
    question_count: int
    answered_count: int
    unanswered_count: int


class ProgressUpdateRequest(BaseModel):
    """Persist the learner's current navigation position."""

    model_config = ConfigDict(extra="forbid")

    current_position: Annotated[int, Field(strict=True, ge=1, le=MAX_EXAM_QUESTIONS)]


class ProgressSavedOut(BaseModel):
    attempt_id: UUID
    status: Literal["in_progress", "submitted"]
    current_position: int
    question_count: int
    answered_count: int
    unanswered_count: int


# ----------------------------------------------------------------------
# JHEP-34: final submission; JHEP-35: per-question feedback and results
# ----------------------------------------------------------------------


class QuestionFeedbackOut(BaseModel):
    """Per-question submit confirmation (screen 07).

    Correctness fields stay null and `feedback_released` stays false in
    deferred feedback mode; answer keys are never included here — only the
    ids of the correct options for the submitted question.
    """

    attempt_id: UUID
    question_version_id: UUID
    is_submitted: bool
    question_submitted_at: datetime | None
    feedback_released: bool
    is_correct: bool | None = None
    correct_option_ids: list[UUID] | None = None
    explanation: str | None = None


class FinalSubmitOut(BaseModel):
    """Final submission confirmation (screen 07 — complete exam)."""

    attempt_id: UUID
    status: Literal["submitted"]
    question_count: int
    answered_count: int
    unanswered_count: int
    submitted_at: datetime
    results_url: str


class ResultsOut(BaseModel):
    """Attempt results (screen 08) — aggregates only, no answer keys."""

    attempt_id: UUID
    certification_id: UUID
    status: Literal["submitted"]
    question_count: int
    answered_count: int
    unanswered_count: int
    correct_count: int
    incorrect_count: int
    unanswered_graded_count: int
    ungraded_count: int
    ungradable_count: int
    graded_count: int
    points_earned: int
    points_possible: int
    score_percent: float | None
    score_basis: Literal["graded_questions_only"]
    passing_score_percent: int | None
    passed: bool | None
    grading_complete: bool
    submitted_at: datetime | None
    graded_at: datetime
