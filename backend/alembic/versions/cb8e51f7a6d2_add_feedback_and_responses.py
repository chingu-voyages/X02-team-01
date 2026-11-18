"""Add feedback modes and saved learner responses (JHEP-32/34/35).

Revision ID: cb8e51f7a6d2
Revises: a3b9f6c2d1e8
Create Date: 2026-10-30 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "cb8e51f7a6d2"
down_revision: str | Sequence[str] | None = "a3b9f6c2d1e8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FEEDBACK_MODES = "('immediate', 'deferred')"


def upgrade() -> None:
    """Add feedback-mode configuration, attempt snapshots, and responses."""
    # The exam admin's feedback mode per certification. Snapshotmed onto every
    # attempt at creation so later config edits never change running attempts.
    op.add_column(
        "certifications",
        sa.Column(
            "feedback_mode",
            sa.String(length=20),
            server_default=sa.text("'deferred'"),
            nullable=False,
        ),
    )
    op.create_check_constraint(
        "ck_certifications_feedback_mode",
        "certifications",
        f"feedback_mode IN {FEEDBACK_MODES}",
    )

    # Same snapshot as the passing threshold: recorded at attempt creation.
    # Older attempts keep NULL ("configured exams only") until mandatory.
    op.add_column(
        "exam_attempts",
        sa.Column("feedback_mode", sa.String(length=20), nullable=True),
    )
    op.create_check_constraint(
        "ck_exam_attempts_feedback_mode",
        "exam_attempts",
        f"feedback_mode IS NULL OR feedback_mode IN {FEEDBACK_MODES}",
    )

    # One saved learner answer per pinned question version per attempt.
    # Only is_submitted = true rows are graded; the attempt has no row or an
    # empty content row for unanswered questions.
    op.create_table(
        "exam_responses",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("attempt_id", sa.Uuid(), nullable=False),
        sa.Column("question_id", sa.Uuid(), nullable=False),
        sa.Column("question_version_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("selected_option_ids", JSONB(), nullable=True),
        sa.Column("text_response", sa.Text(), nullable=True),
        sa.Column(
            "is_submitted",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("is_correct", sa.Boolean(), nullable=True),
        sa.Column(
            "answered_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("question_submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("graded_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "position > 0",
            name="ck_exam_responses_positive_position",
        ),
        sa.CheckConstraint(
            "is_correct IS NULL OR graded_at IS NOT NULL",
            name="ck_exam_responses_graded_correctness",
        ),
        sa.CheckConstraint(
            # An answer needs either selections or a text response; an
            # is_submitted row must therefore always carry content. CASE is
            # deliberate: PostgreSQL does not guarantee AND short-circuit.
            "(CASE WHEN selected_option_ids IS NOT NULL "
            "AND jsonb_typeof(selected_option_ids) = 'array' "
            "THEN jsonb_array_length(selected_option_ids) > 0 ELSE false END) "
            "OR (text_response IS NOT NULL AND length(btrim(text_response)) > 0) "
            "OR is_submitted = false",
            name="ck_exam_responses_content_when_submitted",
        ),
        sa.ForeignKeyConstraint(["attempt_id"], ["exam_attempts.id"]),
        sa.ForeignKeyConstraint(
            ["question_id", "question_version_id"],
            ["question_versions.question_id", "question_versions.id"],
            name="fk_exam_responses_question_version",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "attempt_id",
            "question_version_id",
            name="uq_exam_responses_attempt_version",
        ),
    )
    op.create_index(
        "ix_exam_responses_attempt_id", "exam_responses", ["attempt_id"], unique=False
    )


def downgrade() -> None:
    """Drop saved responses before removing feedback-mode columns."""
    op.drop_index("ix_exam_responses_attempt_id", table_name="exam_responses")
    op.drop_table("exam_responses")

    op.drop_constraint(
        "ck_exam_attempts_feedback_mode",
        "exam_attempts",
        type_="check",
    )
    op.drop_column("exam_attempts", "feedback_mode")

    op.drop_constraint(
        "ck_certifications_feedback_mode",
        "certifications",
        type_="check",
    )
    op.drop_column("certifications", "feedback_mode")
