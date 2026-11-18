"""Add scoring and passing-threshold foundation (JHEP-35).

Revision ID: a3b9f6c2d1e8
Revises: b6c2d4e091a3
Create Date: 2026-10-29 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a3b9f6c2d1e8"
down_revision: str | Sequence[str] | None = "b6c2d4e091a3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


GRADE_OUTCOMES = (
    "correct",
    "incorrect",
    "unanswered",
    "ungraded",
    "ungradable",
)


def upgrade() -> None:
    """Add configurable thresholds and persisted, idempotent scoring."""
    op.add_column(
        "certifications",
        sa.Column("passing_threshold_pct", sa.Integer(), nullable=True),
    )
    op.create_check_constraint(
        "ck_certifications_passing_threshold",
        "certifications",
        "passing_threshold_pct BETWEEN 0 AND 100",
    )

    # Recorded when the attempt is created; later certification edits
    # never affect existing attempts. Older attempts keep NULL ("not
    # assessed") until the attempt snapshot becomes mandatory.
    op.add_column(
        "exam_attempts",
        sa.Column("passing_threshold_pct", sa.Integer(), nullable=True),
    )
    op.create_check_constraint(
        "ck_exam_attempts_passing_threshold",
        "exam_attempts",
        "passing_threshold_pct BETWEEN 0 AND 100",
    )

    op.create_table(
        "exam_question_grades",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("attempt_id", sa.Uuid(), nullable=False),
        sa.Column("question_id", sa.Uuid(), nullable=False),
        sa.Column("question_version_id", sa.Uuid(), nullable=False),
        sa.Column("outcome", sa.String(length=16), nullable=False),
        sa.Column(
            "points_earned",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.CheckConstraint(
            f"outcome IN {GRADE_OUTCOMES}",
            name="ck_exam_question_grades_outcome",
        ),
        sa.CheckConstraint(
            "points_earned >= 0",
            name="ck_exam_question_grades_nonnegative_points",
        ),
        sa.ForeignKeyConstraint(
            ["attempt_id"],
            ["exam_attempts.id"],
        ),
        sa.ForeignKeyConstraint(
            ["question_id", "question_version_id"],
            ["question_versions.question_id", "question_versions.id"],
            name="fk_exam_question_grades_question_version",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "attempt_id",
            "question_version_id",
            name="uq_exam_question_grades_attempt_version",
        ),
    )
    op.create_index(
        "ix_exam_question_grades_attempt_id",
        "exam_question_grades",
        ["attempt_id"],
        unique=False,
    )

    op.create_table(
        "exam_results",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("attempt_id", sa.Uuid(), nullable=False),
        sa.Column("points_earned", sa.Integer(), nullable=False),
        sa.Column("points_possible", sa.Integer(), nullable=False),
        sa.Column("score_pct", sa.Numeric(precision=7, scale=4), nullable=False),
        sa.Column("threshold_pct", sa.Integer(), nullable=False),
        sa.Column("passed", sa.Boolean(), nullable=True),
        sa.Column(
            "graded_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "points_earned >= 0 AND points_possible >= 0",
            name="ck_exam_results_nonnegative_points",
        ),
        sa.CheckConstraint(
            "threshold_pct BETWEEN 0 AND 100",
            name="ck_exam_results_threshold",
        ),
        sa.CheckConstraint(
            "passed IS NOT NULL OR points_possible = 0",
            name="ck_exam_results_passed_only_with_gradables",
        ),
        sa.ForeignKeyConstraint(["attempt_id"], ["exam_attempts.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "attempt_id",
            name="uq_exam_results_attempt_id",
        ),
    )
    op.create_index(
        "ix_exam_results_attempt_id",
        "exam_results",
        ["attempt_id"],
        unique=False,
    )


def downgrade() -> None:
    """Remove scoring tables before dropping threshold columns."""
    op.drop_index(
        "ix_exam_results_attempt_id",
        table_name="exam_results",
    )
    op.drop_table("exam_results")

    op.drop_index(
        "ix_exam_question_grades_attempt_id",
        table_name="exam_question_grades",
    )
    op.drop_table("exam_question_grades")

    op.drop_constraint(
        "ck_exam_attempts_passing_threshold",
        "exam_attempts",
        type_="check",
    )
    op.drop_column("exam_attempts", "passing_threshold_pct")

    op.drop_constraint(
        "ck_certifications_passing_threshold",
        "certifications",
        type_="check",
    )
    op.drop_column("certifications", "passing_threshold_pct")
