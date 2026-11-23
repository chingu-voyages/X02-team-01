"""TOTP MFA enrollment, challenges, and recovery codes (JHEP-109).

- `mfa_login_challenges`: one row per sign-in challenge issued to an
  MFA-required account — the challenge JWT carries this row's id (jti);
  failed attempts are counted here so stateless tokens cannot be
  replayed indefinitely, and the row is consumed on success.
- `mfa_recovery_codes`: single-use recovery codes, stored only as
  SHA-256 digests, shown once at enrollment in plaintext.
"""

import uuid
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import Column, DateTime, Integer, Text
from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    return datetime.now(UTC)


class MfaLoginChallenge(SQLModel, table=True):
    __tablename__ = "mfa_login_challenges"

    id: uuid.UUID = Field(
        default_factory=uuid4,
        primary_key=True,
    )
    user_id: uuid.UUID = Field(
        foreign_key="users.id",
        nullable=False,
        index=True,
    )
    failed_attempts: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False, server_default="0"),
    )
    consumed: bool = Field(
        default=False,
        nullable=False,
    )
    created_at: datetime = Field(
        default_factory=lambda: _utcnow(),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
        ),
    )
    expires_at: datetime = Field(
        default_factory=lambda: _utcnow(),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class MfaRecoveryCode(SQLModel, table=True):
    __tablename__ = "mfa_recovery_codes"

    id: uuid.UUID = Field(
        default_factory=uuid4,
        primary_key=True,
    )
    user_id: uuid.UUID = Field(
        foreign_key="users.id",
        nullable=False,
        index=True,
    )
    code_hash: str = Field(
        sa_column=Column(Text, nullable=False, unique=True),
    )
    used_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: _utcnow(),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
