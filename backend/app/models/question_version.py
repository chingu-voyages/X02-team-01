from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Text, UniqueConstraint
from sqlmodel import Field, SQLModel


class QuestionVersion(SQLModel, table=True):
    __tablename__ = "question_versions"

    __table_args__ = (
        UniqueConstraint(
            "question_id",
            "version_number",
            name="uq_question_versions_question_version",
        ),
    )

    id: UUID = Field(
        default_factory=uuid4,
        primary_key=True,
    )

    question_id: UUID = Field(
        foreign_key="questions.id",
        nullable=False,
    )

    version_number: int = Field(nullable=False)

    question_text: str = Field(
        sa_type=Text(),
        nullable=False,
    )

    question_type: str = Field(
        max_length=32,
        nullable=False,
    )

    review_status: str = Field(
        default="pending",
        max_length=20,
        nullable=False,
    )

    is_published: bool = Field(
        default=False,
        nullable=False,
    )

    submitted_by_id: UUID = Field(
        foreign_key="users.id",
        nullable=False,
    )

    submitted_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_type=DateTime(timezone=True),
        nullable=False,
    )

    reviewed_by_id: UUID | None = Field(
        default=None,
        foreign_key="users.id",
    )

    reviewed_at: datetime | None = Field(
        default=None,
        sa_type=DateTime(timezone=True),
    )

    review_note: str | None = Field(
        default=None,
        sa_type=Text(),
    )
