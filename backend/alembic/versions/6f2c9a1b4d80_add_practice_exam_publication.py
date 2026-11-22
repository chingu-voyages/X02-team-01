"""Create a separate practice-exam publication lifecycle (JHEP-126).

Revision ID: 6f2c9a1b4d80
Revises: a7c1e4f9b2d6
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "6f2c9a1b4d80"
down_revision: str | Sequence[str] | None = "a7c1e4f9b2d6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "practice_exams",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "certification_id",
            sa.Uuid(),
            sa.ForeignKey("certifications.id"),
            nullable=False,
        ),
        sa.Column("category_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("question_count", sa.Integer(), nullable=True),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default=sa.text("'draft'"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["certification_id", "category_id"],
            ["categories.certification_id", "categories.id"],
            name="fk_practice_exams_category_certification",
        ),
        sa.UniqueConstraint(
            "category_id", "name", name="uq_practice_exams_category_name"
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'published', 'unpublished')",
            name="ck_practice_exams_status",
        ),
        sa.CheckConstraint(
            "question_count IS NULL OR question_count BETWEEN 1 AND 100",
            name="ck_practice_exams_question_count",
        ),
    )
    op.create_index(
        "ix_practice_exams_certification_id", "practice_exams", ["certification_id"]
    )
    op.create_index("ix_practice_exams_category_id", "practice_exams", ["category_id"])


def downgrade() -> None:
    op.drop_index("ix_practice_exams_category_id", table_name="practice_exams")
    op.drop_index("ix_practice_exams_certification_id", table_name="practice_exams")
    op.drop_table("practice_exams")
