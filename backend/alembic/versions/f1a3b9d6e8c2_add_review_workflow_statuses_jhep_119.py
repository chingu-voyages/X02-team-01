"""Review workflow statuses: submitted/in_review + inactive (JHEP-119).

Revision ID: f1a3b9d6e8c2
Revises: e5f8a2b7c4d9
"""

from collections.abc import Sequence

from alembic import op

revision: str = "f1a3b9d6e8c2"
down_revision: str | Sequence[str] | None = "e5f8a2b7c4d9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(
        "ck_question_versions_review_status",
        "question_versions",
        type_="check",
    )
    op.create_check_constraint(
        "ck_question_versions_review_status",
        "question_versions",
        "review_status IN ('pending', 'submitted', 'in_review', 'approved', 'rejected')",
    )
    op.drop_constraint(
        "ck_question_versions_publication_status",
        "question_versions",
        type_="check",
    )
    op.create_check_constraint(
        "ck_question_versions_publication_status",
        "question_versions",
        "publication_status IN ('draft', 'active', 'inactive', 'retired')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_question_versions_publication_status",
        "question_versions",
        type_="check",
    )
    op.create_check_constraint(
        "ck_question_versions_publication_status",
        "question_versions",
        "publication_status IN ('draft', 'active', 'retired')",
    )
    op.drop_constraint(
        "ck_question_versions_review_status",
        "question_versions",
        type_="check",
    )
    op.create_check_constraint(
        "ck_question_versions_review_status",
        "question_versions",
        "review_status IN ('pending', 'approved', 'rejected')",
    )
