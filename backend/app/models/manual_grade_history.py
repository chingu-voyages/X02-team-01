"""Manual grading history for written responses (JHEP-122).

Every manual grading action appends one row: the reviewer, their role,
the score, the feedback, and whether the action was a first grade or a
revision (AC5: "authorized grade revisions preserve previous grades...
history"). The live final grade is the `exam_question_grades` row
(updated in place — only one latest final grade counts, AC8).
"""

import uuid
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKeyConstraint,
    Integer,
    String,
    Text,
    func,
)
from sqlmodel import Field, SQLModel


class ManualGradeHistory(SQLModel, table=True):
    __tablename__ = "manual_grade_history"

    __table_args__ = (
        ForeignKeyConstraint(
            ["question_id", "question_version_id"],
            ["question_versions.question_id", "question_versions.id"],
            name="fk_manual_grade_history_question_version",
        ),
        CheckConstraint(
            "action IN ('graded', 'revised')",
            name="ck_manual_grade_history_action",
        ),
        CheckConstraint(
            "score >= 0",
            name="ck_manual_grade_history_nonnegative_score",
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid4,
        primary_key=True,
    )

    attempt_id: uuid.UUID = Field(
        foreign_key="exam_attempts.id",
        nullable=False,
        index=True,
    )
    question_id: uuid.UUID = Field(nullable=False)
    question_version_id: uuid.UUID = Field(nullable=False)

    graded_by_id: uuid.UUID = Field(
        foreign_key="users.id",
        nullable=False,
        index=True,
    )
    grader_role: str = Field(
        max_length=20,
        nullable=False,
    )
    action: str = Field(
        sa_column=Column(String(16), nullable=False),
        description="graded | revised",
    )
    score: int = Field(
        sa_column=Column(Integer, nullable=False),
    )
    max_points: int = Field(
        sa_column=Column(Integer, nullable=False),
    )
    feedback: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=func.now(),
        ),
    )
