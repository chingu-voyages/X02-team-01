"""Merge JHEP-118 import and JHEP-109 MFA migration heads.

Revision ID: a7c1e4f9b2d6
Revises: f6b8a2c4d9e1, e5f8a2b7c4d9
"""

from collections.abc import Sequence

revision: str = "a7c1e4f9b2d6"
down_revision: tuple[str, str] = (
    "f6b8a2c4d9e1",
    "e5f8a2b7c4d9",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Join the import and MFA migration branches."""


def downgrade() -> None:
    """Split back to the two parent migration heads."""
