"""Per-question scoring of a submitted exam attempt (JHEP-35/JHEP-122).

One row exists per pinned question version; duplicates are impossible by
the (attempt_id, question_version_id) unique constraint. Auto grades are
written once, while a manual grade updates the existing ungraded row in
place and keeps every action in manual_grade_history.
"""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    ForeignKeyConstraint,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlmodel import Field, SQLModel


class ExamQuestionGrade(SQLModel, table=True):
    __tablename__ = "exam_question_grades"

    __table_args__ = (
        UniqueConstraint(
            "attempt_id",
            "question_version_id",
            name="uq_exam_question_grades_attempt_version",
        ),
        ForeignKeyConstraint(
            ["question_id", "question_version_id"],
            ["question_versions.question_id", "question_versions.id"],
            name="fk_exam_question_grades_question_version",
        ),
        CheckConstraint(
            "outcome IN "
            "('correct', 'incorrect', 'unanswered', 'ungraded', 'ungradable', 'manually_graded')",
            name="ck_exam_question_grades_outcome",
        ),
        # JHEP-122: manually graded rows carry a nonnegative score <= the
        # rubric maximum and the grader identity (AC5).
        CheckConstraint(
            "outcome != 'manually_graded' OR "
            "(graded_by_id IS NOT NULL AND max_points IS NOT NULL AND "
            "points_earned >= 0 AND points_earned <= max_points)",
            name="ck_exam_question_grades_manual_grading",
        ),
        CheckConstraint(
            "points_earned >= 0",
            name="ck_exam_question_grades_nonnegative_points",
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

    # Pinned versions from exam_attempt_questions; never re-resolved later.
    question_id: UUID = Field(nullable=False)
    question_version_id: UUID = Field(nullable=False)

    # correct | incorrect | unanswered | ungraded (short-answer) | ungradable
    outcome: str = Field(max_length=16, nullable=False)

    points_earned: int = Field(
        default=0,
        nullable=False,
        sa_column_kwargs={"server_default": text("0")},
    )

    # JHEP-122: manual grading (short answers / essays). NULL for the
    # auto-grading outcomes.
    graded_by_id: UUID | None = Field(
        default=None,
        foreign_key="users.id",
        nullable=True,
    )
    grader_role: str | None = Field(
        default=None,
        max_length=20,
        nullable=True,
    )
    max_points: int | None = Field(
        default=None,
        nullable=True,
        sa_column_kwargs={"server_default": text("1")},
    )
    feedback: str | None = Field(
        default=None,
        sa_type=Text,
        nullable=True,
    )
    graded_at: datetime | None = Field(
        default=None,
        nullable=True,
        sa_column_kwargs={"server_default": func.now()},
    )
