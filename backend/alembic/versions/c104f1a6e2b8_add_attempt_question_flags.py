"""Add learner review flags to exam attempt questions (JHEP-104).

Revision ID: c104f1a6e2b8
Revises: f1a3b9d6e8c2
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c104f1a6e2b8"
down_revision: str | Sequence[str] | None = "f1a3b9d6e8c2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "exam_attempt_questions",
        sa.Column(
            "flagged_for_review",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column(
        "exam_attempt_questions",
        "flagged_for_review",
    )
