"""Add bulk question-import staging tables (JHEP-118).

Revision ID: d1a8c4f7e2b9
Revises: c9d4e7a1f3b6
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d1a8c4f7e2b9"
down_revision: str | Sequence[str] | None = "c9d4e7a1f3b6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "question_import_batches",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("uploaded_by_id", sa.Uuid(), nullable=False),
        sa.Column("original_filename", sa.Text(), nullable=False),
        sa.Column("file_type", sa.String(length=16), nullable=False),
        sa.Column("file_size_bytes", sa.Integer(), nullable=False),
        sa.Column("file_sha256", sa.String(length=64), nullable=False),
        sa.Column("template_version", sa.String(length=32), nullable=False),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default=sa.text("'uploaded'"),
            nullable=False,
        ),
        sa.Column(
            "total_rows",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "valid_rows",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "error_rows",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "warning_rows",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "imported_rows",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("failure_message", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "validated_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "imported_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.CheckConstraint(
            "file_type IN ('xlsx', 'zip')",
            name="ck_question_import_batches_file_type",
        ),
        sa.CheckConstraint(
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
        sa.CheckConstraint(
            "file_size_bytes >= 0",
            name="ck_question_import_batches_file_size",
        ),
        sa.CheckConstraint(
            "total_rows >= 0 "
            "AND valid_rows >= 0 "
            "AND error_rows >= 0 "
            "AND warning_rows >= 0 "
            "AND imported_rows >= 0",
            name="ck_question_import_batches_counts",
        ),
        sa.CheckConstraint(
            "length(trim(original_filename)) > 0",
            name="ck_question_import_batches_filename",
        ),
        sa.CheckConstraint(
            "length(trim(template_version)) > 0",
            name="ck_question_import_batches_template_version",
        ),
        sa.CheckConstraint(
            "length(file_sha256) = 64",
            name="ck_question_import_batches_sha256",
        ),
        sa.ForeignKeyConstraint(
            ["uploaded_by_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "uploaded_by_id",
            "file_sha256",
            name="uq_question_import_batches_uploader_hash",
        ),
    )
    op.create_index(
        op.f("ix_question_import_batches_uploaded_by_id"),
        "question_import_batches",
        ["uploaded_by_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_question_import_batches_status"),
        "question_import_batches",
        ["status"],
        unique=False,
    )

    op.create_table(
        "question_import_assets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("batch_id", sa.Uuid(), nullable=False),
        sa.Column("source_filename", sa.Text(), nullable=False),
        sa.Column("normalized_filename", sa.Text(), nullable=False),
        sa.Column(
            "byte_size",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column("media_type", sa.String(length=32), nullable=True),
        sa.Column("temporary_storage_key", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default=sa.text("'uploaded'"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "validated_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "committed_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.CheckConstraint(
            "status IN ('uploaded', 'valid', 'invalid', 'committed', 'discarded')",
            name="ck_question_import_assets_status",
        ),
        sa.CheckConstraint(
            "byte_size >= 0",
            name="ck_question_import_assets_byte_size",
        ),
        sa.CheckConstraint(
            "length(trim(source_filename)) > 0",
            name="ck_question_import_assets_source_filename",
        ),
        sa.CheckConstraint(
            "length(trim(normalized_filename)) > 0",
            name="ck_question_import_assets_normalized_filename",
        ),
        sa.CheckConstraint(
            "sha256 IS NULL OR length(sha256) = 64",
            name="ck_question_import_assets_sha256",
        ),
        sa.CheckConstraint(
            "media_type IS NULL OR "
            "media_type IN ('image/png', 'image/jpeg', 'image/webp')",
            name="ck_question_import_assets_media_type",
        ),
        sa.ForeignKeyConstraint(
            ["batch_id"],
            ["question_import_batches.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "batch_id",
            "normalized_filename",
            name="uq_question_import_assets_batch_filename",
        ),
    )
    op.create_index(
        op.f("ix_question_import_assets_batch_id"),
        "question_import_assets",
        ["batch_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_question_import_assets_status"),
        "question_import_assets",
        ["status"],
        unique=False,
    )

    op.create_table(
        "question_import_rows",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("batch_id", sa.Uuid(), nullable=False),
        sa.Column("row_number", sa.Integer(), nullable=False),
        sa.Column("raw_payload", sa.JSON(), nullable=False),
        sa.Column("normalized_payload", sa.JSON(), nullable=True),
        sa.Column("validation_issues", sa.JSON(), nullable=False),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default=sa.text("'pending'"),
            nullable=False,
        ),
        sa.Column(
            "content_fingerprint",
            sa.String(length=64),
            nullable=True,
        ),
        sa.Column("duplicate_question_id", sa.Uuid(), nullable=True),
        sa.Column("matched_asset_id", sa.Uuid(), nullable=True),
        sa.Column("created_question_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_question_version_id",
            sa.Uuid(),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "imported_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.CheckConstraint(
            "row_number > 1",
            name="ck_question_import_rows_row_number",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'valid', 'invalid', 'imported', 'failed')",
            name="ck_question_import_rows_status",
        ),
        sa.CheckConstraint(
            "content_fingerprint IS NULL OR length(content_fingerprint) = 64",
            name="ck_question_import_rows_fingerprint",
        ),
        sa.ForeignKeyConstraint(
            ["batch_id"],
            ["question_import_batches.id"],
        ),
        sa.ForeignKeyConstraint(
            ["duplicate_question_id"],
            ["questions.id"],
        ),
        sa.ForeignKeyConstraint(
            ["matched_asset_id"],
            ["question_import_assets.id"],
        ),
        sa.ForeignKeyConstraint(
            ["created_question_id"],
            ["questions.id"],
        ),
        sa.ForeignKeyConstraint(
            ["created_question_version_id"],
            ["question_versions.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "batch_id",
            "row_number",
            name="uq_question_import_rows_batch_row",
        ),
    )
    op.create_index(
        op.f("ix_question_import_rows_batch_id"),
        "question_import_rows",
        ["batch_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_question_import_rows_status"),
        "question_import_rows",
        ["status"],
        unique=False,
    )
    op.create_index(
        op.f("ix_question_import_rows_content_fingerprint"),
        "question_import_rows",
        ["content_fingerprint"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_question_import_rows_content_fingerprint"),
        table_name="question_import_rows",
    )
    op.drop_index(
        op.f("ix_question_import_rows_status"),
        table_name="question_import_rows",
    )
    op.drop_index(
        op.f("ix_question_import_rows_batch_id"),
        table_name="question_import_rows",
    )
    op.drop_table("question_import_rows")

    op.drop_index(
        op.f("ix_question_import_assets_status"),
        table_name="question_import_assets",
    )
    op.drop_index(
        op.f("ix_question_import_assets_batch_id"),
        table_name="question_import_assets",
    )
    op.drop_table("question_import_assets")

    op.drop_index(
        op.f("ix_question_import_batches_status"),
        table_name="question_import_batches",
    )
    op.drop_index(
        op.f("ix_question_import_batches_uploaded_by_id"),
        table_name="question_import_batches",
    )
    op.drop_table("question_import_batches")
