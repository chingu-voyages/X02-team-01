"""Add learner registration fields (JHEP-24)

Revision ID: e08bd02f17bf
Revises: d7f3a91c2e60
Create Date: 2026-11-10 14:12:47.257235

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e08bd02f17bf"
down_revision: str | Sequence[str] | None = "d7f3a91c2e60"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add learner registration fields (JHEP-24)."""
    op.add_column("users", sa.Column("hashed_password", sa.Text(), nullable=True))
    op.add_column(
        "users",
        sa.Column(
            "role",
            sa.String(length=20),
            server_default=sa.text("'learner'"),
            nullable=False,
        ),
    )
    op.create_check_constraint(
        "ck_users_role",
        "users",
        "role IN ('learner', 'contributor', 'administrator')",
    )
    op.add_column(
        "users",
        sa.Column(
            "is_verified",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "last_verification_sent_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )

    op.create_table(
        "email_verification_tokens",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column(
            "expires_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now() + interval '24 hours'"),
            nullable=False,
        ),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_email_verification_tokens_token_hash",
        "email_verification_tokens",
        ["token_hash"],
        unique=True,
    )


def downgrade() -> None:
    """Remove registration fields (JHEP-24)."""
    op.drop_index(
        "ix_email_verification_tokens_token_hash",
        table_name="email_verification_tokens",
    )
    op.drop_table("email_verification_tokens")
    op.drop_column("users", "is_verified")
    op.drop_column("users", "last_verification_sent_at")
    op.drop_constraint("ck_users_role", "users", type_="check")
    op.drop_column("users", "role")
    op.drop_column("users", "hashed_password")
