"""Allow the distinct essay question type (JHEP-120).

Revision ID: e120a6b4c9d2
Revises: d122203a4b5c
"""

from collections.abc import Sequence

from alembic import op

revision: str = "e120a6b4c9d2"
down_revision: str | Sequence[str] | None = "d122203a4b5c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_question_versions_type", "question_versions", type_="check")
    op.create_check_constraint(
        "ck_question_versions_type",
        "question_versions",
        "question_type IN ('multiple_choice', 'short_answer', 'essay')",
    )


def downgrade() -> None:
    # PostgreSQL rejects this downgrade while essay rows exist. Do not
    # delete or reclassify existing questions, attempts, or responses.
    op.drop_constraint("ck_question_versions_type", "question_versions", type_="check")
    op.create_check_constraint(
        "ck_question_versions_type",
        "question_versions",
        "question_type IN ('multiple_choice', 'short_answer')",
    )
