"""JHEP-121: essay question type, rubric criteria, markdown authoring text.

Revision ID: f7a2b9c4d6e8
Revises: d122203a4b5c
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f7a2b9c4d6e8"
down_revision: str | Sequence[str] | None = "d122203a4b5c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # JHEP-121 AC1: essays become an authorable question type. JHEP-120
    # still owns the learner-facing essay response entry.
    op.drop_constraint(
        "ck_question_versions_type",
        "question_versions",
        type_="check",
    )
    op.create_check_constraint(
        "ck_question_versions_type",
        "question_versions",
        "question_type IN ('multiple_choice', 'short_answer', 'essay')",
    )

    op.create_table(
        "rubric_criteria",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "question_version_id",
            sa.Uuid(),
            sa.ForeignKey("question_versions.id"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("points", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "position > 0", name="ck_rubric_criteria_positive_position"
        ),
        sa.CheckConstraint(
            "length(trim(name)) > 0", name="ck_rubric_criteria_nonempty_name"
        ),
        sa.CheckConstraint(
            "points > 0", name="ck_rubric_criteria_positive_points"
        ),
        sa.UniqueConstraint(
            "question_version_id",
            "position",
            name="uq_rubric_criteria_version_position",
        ),
    )

    op.add_column(
        "text_answer_keys",
        sa.Column("criteria_markdown", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("text_answer_keys", "criteria_markdown")
    op.drop_table("rubric_criteria")
    op.drop_constraint(
        "ck_question_versions_type",
        "question_versions",
        type_="check",
    )
    op.create_check_constraint(
        "ck_question_versions_type",
        "question_versions",
        "question_type IN ('multiple_choice', 'short_answer')",
    )
