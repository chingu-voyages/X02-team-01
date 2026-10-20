from uuid import UUID, uuid4

from sqlalchemy import Text, UniqueConstraint
from sqlmodel import Field, SQLModel


class AnswerOption(SQLModel, table=True):
    __tablename__ = "answer_options"

    __table_args__ = (
        UniqueConstraint(
            "question_version_id",
            "position",
            name="uq_answer_options_version_position",
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

    option_text: str = Field(
        sa_type=Text,
        nullable=False,
    )

    is_correct: bool = Field(
        default=False,
        nullable=False,
    )

    position: int = Field(
        nullable=False,
    )
