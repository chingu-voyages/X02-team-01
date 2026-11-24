"""TOTP MFA: secrets, challenges, recovery codes (JHEP-109).

Revision ID: e5f8a2b7c4d9
Revises: c9d4e7a1f3b6
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e5f8a2b7c4d9"
down_revision: str | Sequence[str] | None = "c9d4e7a1f3b6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("totp_secret_encrypted", sa.Text(), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("mfa_enrolled_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "mfa_login_challenges",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "failed_attempts",
            sa.Integer(),
            server_default="0",
            nullable=False,
        ),
        sa.Column("consumed", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "mfa_recovery_codes",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("code_hash", sa.Text(), nullable=False, unique=True),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("mfa_recovery_codes")
    op.drop_table("mfa_login_challenges")
    op.drop_column("users", "mfa_enrolled_at")
    op.drop_column("users", "totp_secret_encrypted")
