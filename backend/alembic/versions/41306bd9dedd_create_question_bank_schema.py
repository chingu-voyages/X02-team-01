"""Create question bank schema.

Revision ID: 41306bd9dedd
Revises:
Create Date: 2026-10-21 18:29:01.015927
"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel

from alembic import op

# Revision identifiers, used by Alembic.
revision: str = "41306bd9dedd"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the question bank and its supporting tables."""
    op.create_table(
        "certifications",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column("code", sqlmodel.sql.sqltypes.AutoString(length=50), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )

    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "email", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )

    op.create_table(
        "categories",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("certification_id", sa.Uuid(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.ForeignKeyConstraint(["certification_id"], ["certifications.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "certification_id", "id", name="uq_categories_certification_id"
        ),
        sa.UniqueConstraint(
            "certification_id", "name", name="uq_categories_certification_name"
        ),
    )

    op.create_table(
        "questions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("certification_id", sa.Uuid(), nullable=False),
        sa.Column("category_id", sa.Uuid(), nullable=True),
        sa.Column(
            "difficulty", sqlmodel.sql.sqltypes.AutoString(length=20), nullable=False
        ),
        sa.Column("created_by_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "difficulty IN ('easy', 'medium', 'hard')",
            name="ck_questions_difficulty",
        ),
        sa.ForeignKeyConstraint(
            ["certification_id", "category_id"],
            ["categories.certification_id", "categories.id"],
            name="fk_questions_category_certification",
        ),
        sa.ForeignKeyConstraint(["certification_id"], ["certifications.id"]),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "question_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("question_id", sa.Uuid(), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("question_text", sa.Text(), nullable=False),
        sa.Column(
            "question_type",
            sqlmodel.sql.sqltypes.AutoString(length=32),
            nullable=False,
        ),
        sa.Column(
            "allows_multiple_answers",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("explanation", sa.Text(), nullable=True),
        sa.Column(
            "review_status",
            sqlmodel.sql.sqltypes.AutoString(length=20),
            server_default=sa.text("'pending'"),
            nullable=False,
        ),
        sa.Column(
            "publication_status",
            sqlmodel.sql.sqltypes.AutoString(length=20),
            server_default=sa.text("'draft'"),
            nullable=False,
        ),
        sa.Column(
            "is_flagged",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("submitted_by_id", sa.Uuid(), nullable=False),
        sa.Column(
            "submitted_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("reviewed_by_id", sa.Uuid(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "NOT allows_multiple_answers OR question_type = 'multiple_choice'",
            name="ck_question_versions_multiple_answers",
        ),
        sa.CheckConstraint(
            "publication_status != 'active' OR review_status = 'approved'",
            name="ck_question_versions_publication",
        ),
        sa.CheckConstraint(
            "publication_status IN ('draft', 'active', 'retired')",
            name="ck_question_versions_publication_status",
        ),
        sa.CheckConstraint(
            "question_type IN ('multiple_choice', 'short_answer')",
            name="ck_question_versions_type",
        ),
        sa.CheckConstraint(
            "review_status = 'pending' OR "
            "(reviewed_by_id IS NOT NULL AND reviewed_at IS NOT NULL)",
            name="ck_question_versions_review_information",
        ),
        sa.CheckConstraint(
            "review_status IN ('pending', 'approved', 'rejected')",
            name="ck_question_versions_review_status",
        ),
        sa.CheckConstraint(
            "length(trim(question_text)) > 0",
            name="ck_question_versions_nonempty_text",
        ),
        sa.CheckConstraint(
            "version_number > 0",
            name="ck_question_versions_positive_version",
        ),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"]),
        sa.ForeignKeyConstraint(["reviewed_by_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["submitted_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "question_id",
            "version_number",
            name="uq_question_versions_question_version",
        ),
    )

    op.create_index(
        "uq_question_versions_active_question",
        "question_versions",
        ["question_id"],
        unique=True,
        postgresql_where=sa.text("publication_status = 'active'"),
    )

    op.create_table(
        "answer_options",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("question_version_id", sa.Uuid(), nullable=False),
        sa.Column("option_text", sa.Text(), nullable=False),
        sa.Column(
            "is_correct",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "length(trim(option_text)) > 0",
            name="ck_answer_options_nonempty_text",
        ),
        sa.CheckConstraint("position > 0", name="ck_answer_options_positive_position"),
        sa.ForeignKeyConstraint(["question_version_id"], ["question_versions.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "question_version_id", "position", name="uq_answer_options_version_position"
        ),
    )

    op.create_table(
        "text_answer_keys",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("question_version_id", sa.Uuid(), nullable=False),
        sa.Column("expected_answer", sa.Text(), nullable=False),
        sa.CheckConstraint(
            "length(trim(expected_answer)) > 0",
            name="ck_text_answer_keys_nonempty_answer",
        ),
        sa.ForeignKeyConstraint(["question_version_id"], ["question_versions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    """Remove the question bank and its supporting tables."""
    op.drop_table("text_answer_keys")
    op.drop_table("answer_options")
    op.drop_index(
        "uq_question_versions_active_question",
        table_name="question_versions",
        postgresql_where=sa.text("publication_status = 'active'"),
    )
    op.drop_table("question_versions")
    op.drop_table("questions")
    op.drop_table("categories")
    op.drop_table("users")
    op.drop_table("certifications")
