"""Attempt-level grading outcome: points, exact score, and Pass/Fail (JHEP-35).

One row per attempt (unique `attempt_id`); regrading returns this record
instead of creating another, so duplicate submissions stay consistent.
"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Numeric,
    UniqueConstraint,
    text,
)
from sqlmodel import Field, SQLModel


class ExamResult(SQLModel, table=True):
    __tablename__ = "exam_results"

    __table_args__ = (
        UniqueConstraint(
            "attempt_id",
            name="uq_exam_results_attempt_id",
        ),
        CheckConstraint(
            "points_earned >= 0 AND points_possible >= 0",
            name="ck_exam_results_nonnegative_points",
        ),
        CheckConstraint(
            "threshold_pct BETWEEN 0 AND 100",
            name="ck_exam_results_threshold",
        ),
        CheckConstraint(
            "passed IS NOT NULL OR points_possible = 0",
            name="ck_exam_results_passed_only_with_gradables",
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

    # Points are the source of truth for comparisons; score_pct is a
    # convenience duplicate for the results view and display only.
    points_earned: int = Field(nullable=False)
    points_possible: int = Field(nullable=False)

    score_pct: float = Field(
        sa_type=Numeric(precision=7, scale=4),
        nullable=False,
    )

    # Threshold snapshot copied from the attempt (never re-read the
    # certification), so Pass/Fail stays tied to the creation-time rule.
    threshold_pct: int = Field(nullable=False)

    # None only when the attempt had zero auto-gradable questions.
    passed: bool | None = Field(default=None, nullable=True)

    graded_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_type=DateTime(timezone=True),
        nullable=False,
        sa_column_kwargs={"server_default": text("now()")},
    )
