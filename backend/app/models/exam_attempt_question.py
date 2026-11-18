from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    ForeignKeyConstraint,
    UniqueConstraint,
)
from sqlmodel import Field, SQLModel


class ExamAttemptQuestion(SQLModel, table=True):
    __tablename__ = "exam_attempt_questions"

    __table_args__ = (
        UniqueConstraint(
            "attempt_id",
            "question_id",
            name="uq_exam_attempt_questions_attempt_question",
        ),
        UniqueConstraint(
            "attempt_id",
            "position",
            name="uq_exam_attempt_questions_attempt_position",
        ),
        ForeignKeyConstraint(
            ["question_id", "question_version_id"],
            ["question_versions.question_id", "question_versions.id"],
            name="fk_exam_attempt_questions_question_version",
        ),
        CheckConstraint(
            "position > 0",
            name="ck_exam_attempt_questions_positive_position",
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

    question_id: UUID = Field(nullable=False)

    question_version_id: UUID = Field(nullable=False)

    position: int = Field(nullable=False)
