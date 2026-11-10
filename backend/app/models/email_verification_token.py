"""One-time emailed verification tokens (JHEP-24, AC2).

The raw token lives only in the verification email; the table stores its
SHA-256 digest with one-time (`used_at`) and TTL (`expires_at`) semantics,
so expired/used links fail safely per AC2.
"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Text, text
from sqlmodel import Field, SQLModel


class EmailVerificationToken(SQLModel, table=True):
    __tablename__ = "email_verification_tokens"

    id: UUID = Field(default_factory=uuid4, primary_key=True)

    user_id: UUID = Field(foreign_key="users.id", nullable=False, index=True)

    # SHA-256 of the raw emailed token; the raw value is never stored.
    token_hash: str = Field(sa_type=Text, nullable=False, unique=True)

    expires_at: datetime = Field(
        sa_type=DateTime(timezone=True),
        nullable=False,
        sa_column_kwargs={"server_default": text("now() + interval '24 hours'")},
    )

    # One-time semantics (AC2): a used token can never activate twice.
    used_at: datetime | None = Field(sa_type=DateTime(timezone=True), nullable=True)

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_type=DateTime(timezone=True),
        nullable=False,
        sa_column_kwargs={"server_default": text("now()")},
    )
