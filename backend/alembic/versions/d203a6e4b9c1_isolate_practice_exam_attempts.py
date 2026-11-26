"""Link attempts to their exact published practice exam (JHEP-203).

Revision ID: d203a6e4b9c1
Revises: b3c7d9e2f5a8
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d203a6e4b9c1"
down_revision: str | Sequence[str] | None = "b3c7d9e2f5a8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Existing attempts predate the exam identity link. Keep them intact.
    op.add_column(
        "exam_attempts",
        sa.Column("practice_exam_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_exam_attempts_practice_exam_id",
        "exam_attempts",
        "practice_exams",
        ["practice_exam_id"],
        ["id"],
    )
    op.create_index(
        "ix_exam_attempts_practice_exam_id",
        "exam_attempts",
        ["practice_exam_id"],
        unique=False,
    )
    # The database, not only a service-level lookup, rejects concurrent
    # starts for the same learner and published exam. Retakes are allowed.
    op.create_index(
        "uq_exam_attempts_active_practice_exam",
        "exam_attempts",
        ["user_id", "practice_exam_id"],
        unique=True,
        postgresql_where=sa.text(
            "status = 'in_progress' AND practice_exam_id IS NOT NULL"
        ),
        sqlite_where=sa.text("status = 'in_progress' AND practice_exam_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_exam_attempts_active_practice_exam", table_name="exam_attempts")
    op.drop_index("ix_exam_attempts_practice_exam_id", table_name="exam_attempts")
    op.drop_constraint(
        "fk_exam_attempts_practice_exam_id",
        "exam_attempts",
        type_="foreignkey",
    )
    op.drop_column("exam_attempts", "practice_exam_id")
