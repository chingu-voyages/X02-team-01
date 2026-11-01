"""Add question-version image metadata (JHEP-29/57 integration).

Revision ID: b6c2d4e091a3
Revises: e284dc08f172
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b6c2d4e091a3"
down_revision: str | Sequence[str] | None = "e284dc08f172"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "question_images",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("question_version_id", sa.Uuid(), nullable=False),
        sa.Column("storage_key", sa.Text(), nullable=False),
        sa.Column("alt_text", sa.Text(), nullable=False),
        sa.Column("media_type", sa.String(length=32), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["question_version_id"], ["question_versions.id"]),
        sa.UniqueConstraint(
            "question_version_id",
            "position",
            name="uq_question_images_version_position",
        ),
        sa.CheckConstraint("position > 0", name="ck_question_images_position"),
        sa.CheckConstraint(
            "length(trim(storage_key)) > 0", name="ck_question_images_storage_key"
        ),
        sa.CheckConstraint(
            "length(trim(alt_text)) > 0", name="ck_question_images_alt_text"
        ),
        sa.CheckConstraint(
            "media_type IN ('image/png', 'image/jpeg', 'image/webp')",
            name="ck_question_images_media_type",
        ),
    )
    op.create_index(
        "ix_question_images_question_version_id",
        "question_images",
        ["question_version_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_question_images_question_version_id", table_name="question_images"
    )
    op.drop_table("question_images")
