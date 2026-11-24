"""Staged question rows for a bulk question import."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    UniqueConstraint,
    func,
    text,
)
from sqlmodel import Field, SQLModel


class QuestionImportRow(SQLModel, table=True):
    """One workbook Questions-sheet row and its validation/import result."""

    __tablename__ = "question_import_rows"

    __table_args__ = (
        UniqueConstraint(
            "batch_id",
            "row_number",
            name="uq_question_import_rows_batch_row",
        ),
        CheckConstraint(
            "row_number > 1",
            name="ck_question_import_rows_row_number",
        ),
        CheckConstraint(
            "status IN ('pending', 'valid', 'invalid', 'imported', 'failed')",
            name="ck_question_import_rows_status",
        ),
        CheckConstraint(
            "content_fingerprint IS NULL OR length(content_fingerprint) = 64",
            name="ck_question_import_rows_fingerprint",
        ),
    )

    id: UUID = Field(
        default_factory=uuid4,
        primary_key=True,
    )

    batch_id: UUID = Field(
        foreign_key="question_import_batches.id",
        nullable=False,
        index=True,
    )

    row_number: int = Field(
        nullable=False,
    )

    raw_payload: dict[str, object] = Field(
        default_factory=dict,
        sa_type=JSON,
        nullable=False,
    )

    normalized_payload: dict[str, object] | None = Field(
        default=None,
        sa_type=JSON,
        nullable=True,
    )

    validation_issues: list[dict[str, object]] = Field(
        default_factory=list,
        sa_type=JSON,
        nullable=False,
    )

    status: str = Field(
        default="pending",
        max_length=20,
        nullable=False,
        index=True,
        sa_column_kwargs={
            "server_default": text("'pending'"),
        },
    )

    content_fingerprint: str | None = Field(
        default=None,
        max_length=64,
        nullable=True,
        index=True,
    )

    duplicate_question_id: UUID | None = Field(
        default=None,
        foreign_key="questions.id",
        nullable=True,
    )

    matched_asset_id: UUID | None = Field(
        default=None,
        foreign_key="question_import_assets.id",
        nullable=True,
    )

    created_question_id: UUID | None = Field(
        default=None,
        foreign_key="questions.id",
        nullable=True,
    )

    created_question_version_id: UUID | None = Field(
        default=None,
        foreign_key="question_versions.id",
        nullable=True,
    )

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_type=DateTime(timezone=True),
        nullable=False,
        sa_column_kwargs={"server_default": func.now()},
    )

    imported_at: datetime | None = Field(
        default=None,
        sa_type=DateTime(timezone=True),
        nullable=True,
    )
