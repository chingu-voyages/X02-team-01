from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime
from sqlmodel import Field, SQLModel


class Question(SQLModel, table=True):
    __tablename__ = "questions"

    id: UUID = Field(
        default_factory=uuid4,
        primary_key=True,
    )

    certification_id: UUID = Field(
        foreign_key="certifications.id",
        nullable=False,
    )

    category_id: UUID | None = Field(
        default=None,
        foreign_key="categories.id",
    )

    difficulty: str = Field(
        max_length=20,
        nullable=False,
    )

    created_by_id: UUID = Field(
        foreign_key="users.id",
        nullable=False,
    )

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_type=DateTime(timezone=True),
        nullable=False,
    )
