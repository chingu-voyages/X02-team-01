"""Add exam attempt tables.

Revision ID: e284dc08f172
Revises: 41306bd9dedd
Create Date: 2026-10-26 17:04:26.791860
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e284dc08f172"
down_revision: str | Sequence[str] | None = "41306bd9dedd"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create persisted exam attempts and randomized question assignments."""
    op.create_table(
        "exam_attempts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("certification_id", sa.Uuid(), nullable=False),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default=sa.text("'in_progress'"),
            nullable=False,
        ),
        sa.Column("question_count", sa.Integer(), nullable=False),
        sa.Column(
            "current_position",
            sa.Integer(),
            server_default=sa.text("1"),
            nullable=False,
        ),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('in_progress', 'submitted')",
            name="ck_exam_attempts_status",
        ),
        sa.CheckConstraint(
            "current_position BETWEEN 1 AND question_count",
            name="ck_exam_attempts_current_position",
        ),
        sa.CheckConstraint(
            "question_count > 0",
            name="ck_exam_attempts_positive_count",
        ),
        sa.ForeignKeyConstraint(["certification_id"], ["certifications.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_exam_attempts_certification_id",
        "exam_attempts",
        ["certification_id"],
        unique=False,
    )
    op.create_index(
        "ix_exam_attempts_user_id",
        "exam_attempts",
        ["user_id"],
        unique=False,
    )

    # PostgreSQL requires this unique key BEFORE the composite FK below.
    op.create_unique_constraint(
        "uq_question_versions_question_id",
        "question_versions",
        ["question_id", "id"],
    )

    op.create_table(
        "exam_attempt_questions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("attempt_id", sa.Uuid(), nullable=False),
        sa.Column("question_id", sa.Uuid(), nullable=False),
        sa.Column("question_version_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "position > 0",
            name="ck_exam_attempt_questions_positive_position",
        ),
        sa.ForeignKeyConstraint(["attempt_id"], ["exam_attempts.id"]),
        sa.ForeignKeyConstraint(
            ["question_id", "question_version_id"],
            ["question_versions.question_id", "question_versions.id"],
            name="fk_exam_attempt_questions_question_version",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "attempt_id",
            "position",
            name="uq_exam_attempt_questions_attempt_position",
        ),
        sa.UniqueConstraint(
            "attempt_id",
            "question_id",
            name="uq_exam_attempt_questions_attempt_question",
        ),
    )
    op.create_index(
        "ix_exam_attempt_questions_attempt_id",
        "exam_attempt_questions",
        ["attempt_id"],
        unique=False,
    )


def downgrade() -> None:
    """Remove exam assignments before dropping their referenced keys."""
    op.drop_index(
        "ix_exam_attempt_questions_attempt_id",
        table_name="exam_attempt_questions",
    )
    op.drop_table("exam_attempt_questions")

    # The referencing table has now been removed.
    op.drop_constraint(
        "uq_question_versions_question_id",
        "question_versions",
        type_="unique",
    )

    op.drop_index("ix_exam_attempts_user_id", table_name="exam_attempts")
    op.drop_index("ix_exam_attempts_certification_id", table_name="exam_attempts")
    op.drop_table("exam_attempts")
