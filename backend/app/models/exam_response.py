"""One saved learner answer per pinned question version per attempt (JHEP-32).

Only ``is_submitted = true`` rows are graded by JHEP-35's engine; anything
else is an unsaved draft that may be edited or cleared until the question
is individually submitted or the attempt is finally submitted. Selections
are validated at save time so every stored option belongs to the pinned
question version (the DB mirrors this with the composite foreign key to
``question_versions``).
"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class ExamResponse(SQLModel, table=True):
    __tablename__ = "exam_responses"

    __table_args__ = (
        UniqueConstraint(
            "attempt_id",
            "question_version_id",
            name="uq_exam_responses_attempt_version",
        ),
        ForeignKeyConstraint(
            ["question_id", "question_version_id"],
            ["question_versions.question_id", "question_versions.id"],
            name="fk_exam_responses_question_version",
        ),
        CheckConstraint(
            "position > 0",
            name="ck_exam_responses_positive_position",
        ),
        CheckConstraint(
            "is_correct IS NULL OR graded_at IS NOT NULL",
            name="ck_exam_responses_graded_correctness",
        ),
        CheckConstraint(
            "(CASE WHEN selected_option_ids IS NOT NULL "
            "AND jsonb_typeof(selected_option_ids) = 'array' "
            "THEN jsonb_array_length(selected_option_ids) > 0 ELSE false END) "
            "OR (text_response IS NOT NULL AND length(btrim(text_response)) > 0) "
            "OR is_submitted = false",
            name="ck_exam_responses_content_when_submitted",
        ),
    )

    id: UUID = Field(
        default_factory=uuid4,
        primary_key=True,
    )

    attempt_id: UUID = Field(
        foreign_key="exam_attempts.id",
        nullable=False,
        index=True,
    )

    # Pinned values copied from exam_attempt_questions at save time so the
    # row is self-contained evidence of what was presented and answered.
    question_id: UUID = Field(nullable=False)
    question_version_id: UUID = Field(nullable=False)
    position: int = Field(nullable=False)

    # Exactly one of the two content columns is populated: option
    # selections for multiple choice (list[str|UUID] in JSONB), a text
    # answer for short answers.
    selected_option_ids: list | None = Field(default=None, sa_type=JSONB, nullable=True)
    text_response: str | None = Field(
        sa_type=Text,
        nullable=True,
    )

    # Only submitted rows are graded; multiple-select options are compared
    # as a set (strict exact match — no partial credit).
    is_submitted: bool = Field(
        default=False,
        nullable=False,
        sa_column_kwargs={"server_default": text("false")},
    )
    answered_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_type=DateTime(timezone=True),
        nullable=False,
        sa_column_kwargs={"server_default": text("now()")},
    )
    question_submitted_at: datetime | None = Field(
        sa_type=DateTime(timezone=True),
        nullable=True,
    )

    # Filled by grading (per-question in immediate feedback mode, otherwise
    # when the attempt result is computed).
    is_correct: bool | None = Field(default=None, nullable=True)
    graded_at: datetime | None = Field(
        sa_type=DateTime(timezone=True),
        nullable=True,
    )
