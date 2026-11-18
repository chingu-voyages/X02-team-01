"""Role-change audit trail (JHEP-125).

Revision ID: b7e2c4d9f1a8
Revises: f4c1b8a2d6e3
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b7e2c4d9f1a8"
down_revision: str | Sequence[str] | None = "f4c1b8a2d6e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "role_change_audit",
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
        sa.Column("action", sa.String(length=20), nullable=False),
        sa.Column("role_before", sa.String(length=20), nullable=False),
        sa.Column("role_after", sa.String(length=20), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "action IN ('promoted', 'revoked')",
            name="ck_role_change_audit_action",
        ),
    )


def downgrade() -> None:
    op.drop_table("role_change_audit")
