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

    __table_args__ = (
        # Unique version number per question
        UniqueConstraint(
            "question_id",
            "version_number",
            name="uq_question_versions_question_version",
        ),

        # Positive version numbers
        CheckConstraint(
            "version_number > 0",
            name="ck_question_versions_positive_version",
        ),

        # Supported MVP question formats
        CheckConstraint(
            "question_type IN ('multiple_choice', 'short_answer')",
            name="ck_question_versions_type",
        ),

        # Multi-select applies only to multiple-choice
        CheckConstraint(
            "NOT allows_multiple_answers OR "
            "question_type = 'multiple_choice'",
            name="ck_question_versions_multiple_answers",
        ),

        # Valid review statuses
        CheckConstraint(
            "review_status IN ('pending', 'approved', 'rejected')",
            name="ck_question_versions_review_status",
        ),

        # Valid publication statuses
        CheckConstraint(
            "publication_status IN ('draft', 'active', 'retired')",
            name="ck_question_versions_publication_status",
        ),

        # Only approved versions may be active
        CheckConstraint(
            "publication_status != 'active' OR "
            "review_status = 'approved'",
            name="ck_question_versions_publication",
        ),

        # Prevent blank questions
        CheckConstraint(
            "length(trim(question_text)) > 0",
            name="ck_question_versions_nonempty_text",
        ),

        # Reviewed questions need review information
        CheckConstraint(
            "review_status = 'pending' OR "
            "(reviewed_by_id IS NOT NULL AND "
            "reviewed_at IS NOT NULL)",
            name="ck_question_versions_review_information",
        ),

        # Only one active version per question
        Index(
            "uq_question_versions_active_question",
            "question_id",
            unique=True,
            postgresql_where=text(
                "publication_status = 'active'"
            ),
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

    version_number: int = Field(nullable=False)

    # Question content
    question_text: str = Field(
        sa_type=Text,
        nullable=False,
    )

    question_type: str = Field(
        max_length=32,
        nullable=False,
    )

    # Answer selection configuration
    allows_multiple_answers: bool = Field(
        default=False,
        nullable=False,
    )

    # Optional post-submission explanation
    explanation: str | None = Field(
        default=None,
        sa_type=Text,
        nullable=True,
    )

    # Review state
    review_status: str = Field(
        default="pending",
        max_length=20,
        nullable=False,
    )

    # Publication state
    publication_status: str = Field(
        default="draft",
        max_length=20,
        nullable=False,
    )

    # Editorial flag
    is_flagged: bool = Field(
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
