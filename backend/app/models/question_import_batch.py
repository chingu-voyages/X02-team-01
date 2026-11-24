"""Bulk question-import batch metadata."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlmodel import Field, SQLModel


class QuestionImportBatch(SQLModel, table=True):
    """One uploaded workbook/package and its validation/import lifecycle."""

    __tablename__ = "question_import_batches"

    __table_args__ = (
        UniqueConstraint(
            "uploaded_by_id",
            "file_sha256",
            name="uq_question_import_batches_uploader_hash",
        ),
        CheckConstraint(
            "file_type IN ('xlsx', 'zip')",
            name="ck_question_import_batches_file_type",
        ),
        CheckConstraint(
            "status IN ("
            "'uploaded', "
            "'validating', "
            "'invalid', "
            "'ready', "
            "'importing', "
            "'imported', "
            "'failed', "
            "'cancelled'"
            ")",
            name="ck_question_import_batches_status",
        ),
        CheckConstraint(
            "file_size_bytes >= 0",
            name="ck_question_import_batches_file_size",
        ),
        CheckConstraint(
            "total_rows >= 0 "
            "AND valid_rows >= 0 "
            "AND error_rows >= 0 "
            "AND warning_rows >= 0 "
            "AND imported_rows >= 0",
            name="ck_question_import_batches_counts",
        ),
        CheckConstraint(
            "length(trim(original_filename)) > 0",
            name="ck_question_import_batches_filename",
        ),
        CheckConstraint(
            "length(trim(template_version)) > 0",
            name="ck_question_import_batches_template_version",
        ),
        CheckConstraint(
            "length(file_sha256) = 64",
            name="ck_question_import_batches_sha256",
        ),
    )

    id: UUID = Field(
        default_factory=uuid4,
        primary_key=True,
    )

    uploaded_by_id: UUID = Field(
        foreign_key="users.id",
        nullable=False,
        index=True,
    )

    original_filename: str = Field(
        sa_type=Text,
        nullable=False,
    )

    file_type: str = Field(
        max_length=16,
        nullable=False,
    )

    file_size_bytes: int = Field(
        nullable=False,
    )

    file_sha256: str = Field(
        max_length=64,
        nullable=False,
    )

    template_version: str = Field(
        max_length=32,
        nullable=False,
    )

    status: str = Field(
        default="uploaded",
        max_length=20,
        nullable=False,
        index=True,
        sa_column_kwargs={
            "server_default": text("'uploaded'"),
        },
    )

    total_rows: int = Field(
        default=0,
        nullable=False,
        sa_column_kwargs={"server_default": text("0")},
    )

    valid_rows: int = Field(
        default=0,
        nullable=False,
        sa_column_kwargs={"server_default": text("0")},
    )

    error_rows: int = Field(
        default=0,
        nullable=False,
        sa_column_kwargs={"server_default": text("0")},
    )

    warning_rows: int = Field(
        default=0,
        nullable=False,
        sa_column_kwargs={"server_default": text("0")},
    )

    imported_rows: int = Field(
        default=0,
        nullable=False,
        sa_column_kwargs={"server_default": text("0")},
    )

    failure_message: str | None = Field(
        default=None,
        sa_type=Text,
        nullable=True,
    )

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_type=DateTime(timezone=True),
        nullable=False,
        sa_column_kwargs={"server_default": func.now()},
    )

    validated_at: datetime | None = Field(
        default=None,
        sa_type=DateTime(timezone=True),
        nullable=True,
    )

    imported_at: datetime | None = Field(
        default=None,
        sa_type=DateTime(timezone=True),
        nullable=True,
    )
