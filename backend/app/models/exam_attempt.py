from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, func, text
from sqlmodel import Field, SQLModel


class ExamAttempt(SQLModel, table=True):
    __tablename__ = "exam_attempts"

    __table_args__ = (
        CheckConstraint(
            "status IN ('in_progress', 'submitted')",
            name="ck_exam_attempts_status",
        ),
        CheckConstraint(
            "question_count > 0",
            name="ck_exam_attempts_positive_count",
        ),
        CheckConstraint(
            "current_position BETWEEN 1 AND question_count",
            name="ck_exam_attempts_current_position",
        ),
        CheckConstraint(
            "passing_threshold_pct BETWEEN 0 AND 100",
            name="ck_exam_attempts_passing_threshold",
        ),
        CheckConstraint(
            "feedback_mode IS NULL OR feedback_mode IN ('immediate', 'deferred')",
            name="ck_exam_attempts_feedback_mode",
        ),
    )

    id: UUID = Field(
        default_factory=uuid4,
        primary_key=True,
    )

    user_id: UUID = Field(
        foreign_key="users.id",
        nullable=False,
        index=True,
    )

    certification_id: UUID = Field(
        foreign_key="certifications.id",
        nullable=False,
        index=True,
    )

    status: str = Field(
        default="in_progress",
        max_length=20,
        nullable=False,
        sa_column_kwargs={"server_default": text("'in_progress'")},
    )

    question_count: int = Field(nullable=False)

    # Threshold snapshot recorded at attempt creation; older attempts keep
    # NULL ("not assessed"). Certification edits never change this value.
    passing_threshold_pct: int | None = Field(
        default=None,
        nullable=True,
    )

    # Feedback-mode snapshot recorded at attempt creation (same rule):
    # 'immediate' | 'deferred' | NULL for pre-config attempts. Exam-admin
    # edits never change an attempt that is running or completed.
    feedback_mode: str | None = Field(
        default=None,
        max_length=20,
        nullable=True,
    )

    current_position: int = Field(
        default=1,
        nullable=False,
        sa_column_kwargs={"server_default": text("1")},
    )

    started_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_type=DateTime(timezone=True),
        nullable=False,
        sa_column_kwargs={"server_default": func.now()},
    )

    submitted_at: datetime | None = Field(
        default=None,
        sa_type=DateTime(timezone=True),
        nullable=True,
    )
