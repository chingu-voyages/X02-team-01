
from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKeyConstraint
from sqlmodel import Field, SQLModel


class Question(SQLModel, table=True):
    __tablename__ = "questions"

    __table_args__ = (
        CheckConstraint(
            "difficulty IN ('easy', 'medium', 'hard')",
            name="ck_questions_difficulty",
        ),
        ForeignKeyConstraint(
            ["certification_id", "category_id"],
            ["categories.certification_id", "categories.id"],
            name="fk_questions_category_certification",
        ),
    )

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
        nullable=True,
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
