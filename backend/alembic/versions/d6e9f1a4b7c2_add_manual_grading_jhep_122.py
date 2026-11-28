"""Manual grading: outcomes, rubric max, grader columns, history (JHEP-122).

Revision ID: d6e9f1a4b7c2
Revises: b3c7d9e2f5a8
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d6e9f1a4b7c2"
down_revision: str | Sequence[str] | None = "b3c7d9e2f5a8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(
        "ck_exam_question_grades_outcome",
        "exam_question_grades",
        type_="check",
    )
    op.create_check_constraint(
        "ck_exam_question_grades_outcome",
        "exam_question_grades",
        "outcome IN ('correct', 'incorrect', 'unanswered', 'ungraded', "
        "'ungradable', 'manually_graded')",
    )
    op.add_column(
        "exam_question_grades",
        sa.Column(
            "graded_by_id",
            sa.Uuid(),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
    )
    op.add_column(
        "exam_question_grades",
        sa.Column("grader_role", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "exam_question_grades",
        sa.Column(
            "max_points",
            sa.Integer(),
            server_default="1",
            nullable=True,
        ),
    )
    op.add_column(
        "exam_question_grades",
        sa.Column("feedback", sa.Text(), nullable=True),
    )
    op.add_column(
        "exam_question_grades",
        sa.Column(
            "graded_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
    )
    op.create_check_constraint(
        "ck_exam_question_grades_manual_grading",
        "exam_question_grades",
        "outcome != 'manually_graded' OR "
        "(graded_by_id IS NOT NULL AND max_points IS NOT NULL AND "
        "points_earned >= 0 AND points_earned <= max_points)",
    )
    op.add_column(
        "text_answer_keys",
        sa.Column(
            "max_points",
            sa.Integer(),
            server_default="1",
            nullable=False,
        ),
    )
    op.create_table(
        "manual_grade_history",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "attempt_id",
            sa.Uuid(),
            sa.ForeignKey("exam_attempts.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("question_id", sa.Uuid(), nullable=False),
        sa.Column("question_version_id", sa.Uuid(), nullable=False),
        sa.Column(
            "graded_by_id",
            sa.Uuid(),
            sa.ForeignKey("users.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("grader_role", sa.String(length=20), nullable=False),
        sa.Column("action", sa.String(length=16), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("max_points", sa.Integer(), nullable=False),
        sa.Column("feedback", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["question_id", "question_version_id"],
            ["question_versions.question_id", "question_versions.id"],
            name="fk_manual_grade_history_question_version",
        ),
        sa.CheckConstraint(
            "action IN ('graded', 'revised')",
            name="ck_manual_grade_history_action",
        ),
        sa.CheckConstraint(
            "score >= 0", name="ck_manual_grade_history_nonnegative_score"
        ),
    )


def downgrade() -> None:
    op.drop_table("manual_grade_history")
    op.drop_column("text_answer_keys", "max_points")
    op.drop_constraint(
        "ck_exam_question_grades_manual_grading",
        "exam_question_grades",
        type_="check",
    )
    op.drop_column("exam_question_grades", "graded_at")
    op.drop_column("exam_question_grades", "feedback")
    op.drop_column("exam_question_grades", "max_points")
    op.drop_column("exam_question_grades", "grader_role")
    op.drop_column("exam_question_grades", "graded_by_id")
    op.drop_constraint(
        "ck_exam_question_grades_outcome",
        "exam_question_grades",
        type_="check",
    )
    op.create_check_constraint(
        "ck_exam_question_grades_outcome",
        "exam_question_grades",
        "outcome IN ('correct', 'incorrect', 'unanswered', 'ungraded', 'ungradable')",
    )
