"""Password-reset challenge tokens (JHEP-124).

Mirrors email_verification_tokens: the raw token is emailed, only its
SHA-256 digest is stored, it is single-use (used_at), time-limited
(1 hour — a live credential is more sensitive than an email
verification), and one live challenge per account at a time (a new
request invalidates prior unused ones).
"""

import uuid
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import Column, DateTime, Text
from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    return datetime.now(UTC)


class PasswordResetToken(SQLModel, table=True):
    __tablename__ = "password_reset_tokens"

    id: uuid.UUID = Field(
        default_factory=uuid4,
        primary_key=True,
    )

    user_id: uuid.UUID = Field(
        foreign_key="users.id",
        nullable=False,
        index=True,
    )
    token_hash: str = Field(
        sa_column=Column(Text, nullable=False, unique=True),
    )
    expires_at: datetime = Field(
        default_factory=lambda: _utcnow(),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    used_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: _utcnow(),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
