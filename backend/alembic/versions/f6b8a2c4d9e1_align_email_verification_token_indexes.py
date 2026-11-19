"""Align email verification token constraints with the SQLModel definition.

Revision ID: f6b8a2c4d9e1
Revises: d1a8c4f7e2b9

The original JHEP-24 migration represented token_hash uniqueness as a
unique index and omitted the user_id index declared by the model.
Alembic therefore reported schema/model drift.

This migration changes only indexes/constraints; token data is untouched.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "f6b8a2c4d9e1"
down_revision: str | Sequence[str] | None = "d1a8c4f7e2b9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Make the database match EmailVerificationToken metadata."""

    op.create_index(
        op.f("ix_email_verification_tokens_user_id"),
        "email_verification_tokens",
        ["user_id"],
        unique=False,
    )

    op.create_unique_constraint(
        "uq_email_verification_tokens_token_hash",
        "email_verification_tokens",
        ["token_hash"],
    )

    op.drop_index(
        "ix_email_verification_tokens_token_hash",
        table_name="email_verification_tokens",
    )


def downgrade() -> None:
    """Restore the original JHEP-24 index layout."""

    op.create_index(
        "ix_email_verification_tokens_token_hash",
        "email_verification_tokens",
        ["token_hash"],
        unique=True,
    )

    op.drop_constraint(
        "uq_email_verification_tokens_token_hash",
        "email_verification_tokens",
        type_="unique",
    )

    op.drop_index(
        op.f("ix_email_verification_tokens_user_id"),
        table_name="email_verification_tokens",
    )
