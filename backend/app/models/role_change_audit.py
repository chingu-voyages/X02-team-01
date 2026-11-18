"""Role-change audit trail (JHEP-125).

One row per Administrator-managed Learner<->Contributor role change:
who changed what, for whom, from which role to which, and when. The
publishing of these events to the central audit pipeline is JHEP-111's
job and is deliberately not wired here (non-blocking per the story).
"""

import uuid
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import CheckConstraint, Column, DateTime, String, Text, func
from sqlmodel import Field, SQLModel


class RoleChangeAudit(SQLModel, table=True):
    __tablename__ = "role_change_audit"

    id: uuid.UUID = Field(
        default_factory=uuid4,
        primary_key=True,
    )

    actor_id: uuid.UUID = Field(
        foreign_key="users.id",
        nullable=False,
        index=True,
        description="The Administrator who performed the change.",
    )
    target_id: uuid.UUID = Field(
        foreign_key="users.id",
        nullable=False,
        index=True,
        description="The account whose role changed.",
    )
    action: str = Field(
        sa_column=Column(String(20), nullable=False),
        description="promoted | revoked",
    )
    role_before: str = Field(
        sa_column=Column(String(20), nullable=False),
    )
    role_after: str = Field(
        sa_column=Column(String(20), nullable=False),
    )
    # JHEP-111 will publish structured events; keep a free-form slot now
    # so the payload convention has somewhere to live.
    note: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=func.now(),
        ),
    )

    __table_args__ = (
        CheckConstraint(
            "action IN ('promoted', 'revoked')",
            name="ck_role_change_audit_action",
        ),
    )
