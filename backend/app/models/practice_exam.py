"""Configured practice exams and their administrator-controlled availability.

JHEP-126: exam publication is separate from certification, category, and
individual question publication. A draft is not learner-visible.

JHEP-107 will supply the admin configuration form for ``question_count``.
NULL deliberately means "not configured", rather than assuming an exam size.
"""

from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, ForeignKeyConstraint, UniqueConstraint, text
from sqlmodel import Field, SQLModel


class PracticeExam(SQLModel, table=True):
    __tablename__ = "practice_exams"

    __table_args__ = (
        # A category must belong to the selected certification, even if a
        # caller bypasses API validation and writes directly to the database.
        ForeignKeyConstraint(
            ["certification_id", "category_id"],
            ["categories.certification_id", "categories.id"],
            name="fk_practice_exams_category_certification",
        ),
        UniqueConstraint(
            "category_id",
            "name",
            name="uq_practice_exams_category_name",
        ),
        CheckConstraint(
            "status IN ('draft', 'published', 'unpublished')",
            name="ck_practice_exams_status",
        ),
        CheckConstraint(
            "question_count IS NULL OR question_count BETWEEN 1 AND 100",
            name="ck_practice_exams_question_count",
        ),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)

    certification_id: UUID = Field(
        foreign_key="certifications.id",
        nullable=False,
        index=True,
    )

    category_id: UUID = Field(
        nullable=False,
        index=True,
    )

    name: str = Field(
        max_length=255,
        nullable=False,
    )

    # A missing count makes an exam ineligible for publication. The MVP does
    # not silently use the learner's old, client-selected question count.
    question_count: int | None = Field(
        default=None,
        nullable=True,
    )

    status: str = Field(
        default="draft",
        max_length=20,
        nullable=False,
        sa_column_kwargs={"server_default": text("'draft'")},
    )
