"""Per-question scoring of a submitted exam attempt (JHEP-35).

Rows are immutable evidence of a single grading run; duplicates are
impossible by the (attempt_id, question_version_id) unique constraint.
"""

from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, ForeignKeyConstraint, UniqueConstraint, text
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
            "('correct', 'incorrect', 'unanswered', 'ungraded', 'ungradable')",
            name="ck_exam_question_grades_outcome",
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
