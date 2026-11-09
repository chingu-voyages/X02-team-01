"""Add the three supported account roles (JHEP-26).

Revision ID: f2a1c7d9e430
Revises: d7f3a91c2e60

Existing accounts become Learners. This migration never promotes an account.
Keep historical role values here rather than importing application enums.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f2a1c7d9e430"
down_revision: str | Sequence[str] | None = "d7f3a91c2e60"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add a non-null role with an inline, named database constraint."""
    op.add_column(
        "users",
        sa.Column(
            "role",
            sa.String(length=32),
            sa.CheckConstraint(
                "role IN ('learner', 'contributor', 'administrator')",
                name="ck_users_role",
            ),
            server_default=sa.text("'learner'"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Remove role information without deleting accounts."""
    # The constraint is attached to the column and is removed with it.
    op.drop_column("users", "role")
