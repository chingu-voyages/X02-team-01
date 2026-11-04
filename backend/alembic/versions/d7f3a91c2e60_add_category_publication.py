"""Add explicit category publication (JHEP-27).

Revision ID: d7f3a91c2e60
Revises: cb8e51f7a6d2
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d7f3a91c2e60"
down_revision: str | Sequence[str] | None = "cb8e51f7a6d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Existing and newly inserted categories remain unpublished by default."""
    op.add_column(
        "categories",
        sa.Column(
            "is_published",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Remove publication state; keep category rows and their existing fields."""
    op.drop_column("categories", "is_published")
