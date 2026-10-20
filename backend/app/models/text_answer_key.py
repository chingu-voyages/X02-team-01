from uuid import UUID, uuid4

from sqlalchemy import Text
from sqlmodel import Field, SQLModel


class TextAnswerKey(SQLModel, table=True):
    __tablename__ = "text_answer_keys"

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
