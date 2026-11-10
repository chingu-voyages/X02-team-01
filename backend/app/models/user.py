from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, Column, DateTime, Text, func
from sqlmodel import Field, SQLModel


class User(SQLModel, table=True):
    __tablename__ = "users"

    __table_args__ = (
        # JHEP-24/AC1: self-registration can only ever write the Learner
        # role; elevated values are unrepresentable through this table.
        CheckConstraint(
            "role IN ('learner', 'contributor', 'administrator')",
            name="ck_users_role",
        ),
    )

    id: UUID = Field(
        default_factory=uuid4,
        primary_key=True,
    )

    email: str = Field(
        max_length=255,
        unique=True,
        nullable=False,
    )

    # AC1: display name collected at registration; trimmed by the
    # registration schema (1-255 chars).
    full_name: str = Field(
        default="",
        max_length=255,
        nullable=False,
    )

    # AC3: Argon2id digest of the registration password (see
    # core/security.py). Created only inside the registration service;
    # never logged or returned. Nullable because the seeded demo learner
    # predates credential-based accounts.
    hashed_password: str | None = Field(
        default=None,
        sa_type=Text,
        nullable=True,
    )

    # AC1: default Learner role; never grants Contributor/Administrator
    # from self-registration.
    role: str = Field(
        default="learner",
        max_length=20,
        nullable=False,
    )

    # AC2: pending-verification state until the emailed one-time link is
    # consumed; login (JHEP-25) enforces this only for credential accounts.
    is_verified: bool = Field(
        default=False,
        nullable=False,
    )

    # AC2: rate-limits the resend endpoint (one per 60 seconds).
    last_verification_sent_at: datetime | None = Field(
        default=None,
        sa_type=DateTime(timezone=True),
        nullable=True,
    )

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=func.now(),
        ),
    )
