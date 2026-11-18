"""Add full_name to users (JHEP-24)

Revision ID: db2edc6ff57e
Revises: e08bd02f17bf
Create Date: 2026-11-10 16:02:38.115054

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "db2edc6ff57e"
down_revision: str | Sequence[str] | None = "e08bd02f17bf"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the learner display name (JHEP-24 AC1: required field)."""
    op.add_column(
        "users",
        sa.Column(
            "full_name",
            sa.String(length=255),
            server_default=sa.text("''"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Remove the learner display name."""
    op.drop_column("users", "full_name")
