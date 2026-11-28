"""Add an optimistic recovery revision for learner exam attempts (JHEP-89).

Revision ID: e089a1b2c3d4
Revises: d122203a4b5c
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e089a1b2c3d4"
down_revision: str | Sequence[str] | None = "d122203a4b5c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "exam_attempts",
        sa.Column(
            "recovery_revision", sa.Integer(), nullable=False, server_default="0"
        ),
    )
    op.create_check_constraint(
        "ck_exam_attempts_recovery_revision", "exam_attempts", "recovery_revision >= 0"
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_exam_attempts_recovery_revision", "exam_attempts", type_="check"
    )
    op.drop_column("exam_attempts", "recovery_revision")
