"""Contributor grading permissions + the audit (JHEP-192).

Revision ID: b3c7d9e2f5a8
Revises: c104f1a6e2b8
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b3c7d9e2f5a8"
down_revision: str | Sequence[str] | None = "c104f1a6e2b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "grade_short_answers",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "grade_essays",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
    )
    op.create_table(
        "permission_change_audit",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "actor_id",
            sa.Uuid(),
            sa.ForeignKey("users.id"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "target_id",
            sa.Uuid(),
            sa.ForeignKey("users.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("permission", sa.String(length=40), nullable=False),
        sa.Column("action", sa.String(length=20), nullable=False),
        sa.Column("previous_value", sa.Boolean(), nullable=False),
        sa.Column("new_value", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("permission_change_audit")
    op.drop_column("users", "grade_essays")
    op.drop_column("users", "grade_short_answers")
