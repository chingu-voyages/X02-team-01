from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, Text, text
from sqlmodel import Field, SQLModel


class TextAnswerKey(SQLModel, table=True):
    __tablename__ = "text_answer_keys"

    __table_args__ = (
        CheckConstraint(
            "length(trim(expected_answer)) > 0",
            name="ck_text_answer_keys_nonempty_answer",
        ),
    )

    id: UUID = Field(
        default_factory=uuid4,
        primary_key=True,
    )

    question_version_id: UUID = Field(
        foreign_key="question_versions.id",
        nullable=False,
    )

    expected_answer: str = Field(
        sa_type=Text,
        nullable=False,
    )

    # JHEP-122: the minimal rubric — the manual score range ceiling for
    # this key's question (default 1, matching the implicit per-question
    # point value of the auto-graded MCQs). The full rubric model is
    # JHEP-121's scope.
    max_points: int = Field(
        default=1,
        nullable=False,
        sa_column_kwargs={"server_default": text("1")},
    )
