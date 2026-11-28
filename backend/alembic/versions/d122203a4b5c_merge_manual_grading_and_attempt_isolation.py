"""Merge the manual grading and practice exam attempt isolation revisions.

Revision ID: d122203a4b5c
Revises: d6e9f1a4b7c2, d203a6e4b9c1
"""

from collections.abc import Sequence

revision: str = "d122203a4b5c"
down_revision: str | Sequence[str] | None = ("d6e9f1a4b7c2", "d203a6e4b9c1")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
