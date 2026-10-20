from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Index,
    Text,
    UniqueConstraint,
    text,
)
from sqlmodel import Field, SQLModel


class QuestionVersion(SQLModel, table=True):
    __tablename__ = "question_versions"

    # Database constraints
    __table_args__ = (
        # Prevent duplicate version numbers
        UniqueConstraint(
            "question_id",
            "version_number",
            name="uq_question_versions_question_version",
        ),

        # Version numbers must be positive
        CheckConstraint(
            "version_number > 0",
            name="ck_question_versions_positive_version",
        ),

        # Supported MVP question types
        CheckConstraint(
            "question_type IN ('multiple_choice', 'short_answer')",
            name="ck_question_versions_type",
        ),

        # Valid review statuses
        CheckConstraint(
            "review_status IN ('pending', 'approved', 'rejected')",
            name="ck_question_versions_review_status",
        ),

        # Only approved versions can be published
        CheckConstraint(
            "NOT is_published OR review_status = 'approved'",
            name="ck_question_versions_publication",
        ),

        # Question text cannot be empty
        CheckConstraint(
            "length(trim(question_text)) > 0",
            name="ck_question_versions_nonempty_text",
        ),

        # Reviewed versions require reviewer information
        CheckConstraint(
            "review_status = 'pending' OR "
            "(reviewed_by_id IS NOT NULL AND reviewed_at IS NOT NULL)",
            name="ck_question_versions_review_information",
        ),

        # Only one published version per question
        Index(
            "uq_question_versions_published_question",
            "question_id",
            unique=True,
            postgresql_where=text("is_published IS TRUE"),
        ),
    )

    # Primary key
    id: UUID = Field(
        default_factory=uuid4,
        primary_key=True,
    )

    # Parent question
    question_id: UUID = Field(
        foreign_key="questions.id",
        nullable=False,
    )

    # Version number
    version_number: int = Field(
        nullable=False,
    )

    # Question content
    question_text: str = Field(
        sa_type=Text,
        nullable=False,
    )

    question_type: str = Field(
        max_length=32,
        nullable=False,
    )

    # Review and publication
    review_status: str = Field(
        default="pending",
        max_length=20,
        nullable=False,
    )

    is_published: bool = Field(
        default=False,
        nullable=False,
    )

    # Submission information
    submitted_by_id: UUID = Field(
        foreign_key="users.id",
        nullable=False,
    )

    submitted_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_type=DateTime(timezone=True),
        nullable=False,
    )

    # Review information
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
        sa_type=Text,
    )
