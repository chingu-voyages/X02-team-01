"""Add explicit certification publication (JHEP-159).

Revision ID: f4c1b8a2d6e3
Revises: db2edc6ff57e
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f4c1b8a2d6e3"
down_revision: str | Sequence[str] | None = "db2edc6ff57e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Preserve existing certifications as published."""
    op.add_column(
        "certifications",
        sa.Column(
            "is_published",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Remove certification publication state."""
    op.drop_column(
        "certifications",
        "is_published",
    )
