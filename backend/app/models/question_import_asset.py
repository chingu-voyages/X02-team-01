"""Uploaded image assets staged for a bulk question import."""

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


class QuestionImportAsset(SQLModel, table=True):
    """One uploaded image file available for filename matching."""

    __tablename__ = "question_import_assets"

    __table_args__ = (
        UniqueConstraint(
            "batch_id",
            "normalized_filename",
            name="uq_question_import_assets_batch_filename",
        ),
        CheckConstraint(
            "status IN ('uploaded', 'valid', 'invalid', 'committed', 'discarded')",
            name="ck_question_import_assets_status",
        ),
        CheckConstraint(
            "byte_size >= 0",
            name="ck_question_import_assets_byte_size",
        ),
        CheckConstraint(
            "length(trim(source_filename)) > 0",
            name="ck_question_import_assets_source_filename",
        ),
        CheckConstraint(
            "length(trim(normalized_filename)) > 0",
            name="ck_question_import_assets_normalized_filename",
        ),
        CheckConstraint(
            "sha256 IS NULL OR length(sha256) = 64",
            name="ck_question_import_assets_sha256",
        ),
        CheckConstraint(
            "media_type IS NULL OR "
            "media_type IN ('image/png', 'image/jpeg', 'image/webp')",
            name="ck_question_import_assets_media_type",
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

    source_filename: str = Field(
        sa_type=Text,
        nullable=False,
    )

    normalized_filename: str = Field(
        sa_type=Text,
        nullable=False,
    )

    byte_size: int = Field(
        default=0,
        nullable=False,
        sa_column_kwargs={"server_default": text("0")},
    )

    sha256: str | None = Field(
        default=None,
        max_length=64,
        nullable=True,
    )

    media_type: str | None = Field(
        default=None,
        max_length=32,
        nullable=True,
    )

    temporary_storage_key: str | None = Field(
        default=None,
        sa_type=Text,
        nullable=True,
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

    committed_at: datetime | None = Field(
        default=None,
        sa_type=DateTime(timezone=True),
        nullable=True,
    )
