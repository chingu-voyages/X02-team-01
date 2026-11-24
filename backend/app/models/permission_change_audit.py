"""Grading-permission change audit (JHEP-192).

One row per Administrator save of a Contributor's written-response
grading permissions: who changed what, for whom, and the previous/new
flag values. Mirrors role_change_audit's discipline (AC5). Publishing
to the central audit pipeline is JHEP-111's job and deliberately not
wired here.
"""

import uuid
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import Column, DateTime, String, func
from sqlmodel import Field, SQLModel


class PermissionChangeAudit(SQLModel, table=True):
    __tablename__ = "permission_change_audit"

    id: uuid.UUID = Field(
        default_factory=uuid4,
        primary_key=True,
    )

    actor_id: uuid.UUID = Field(
        foreign_key="users.id",
        nullable=False,
        index=True,
        description="The Administrator who saved the permissions.",
    )
    target_id: uuid.UUID = Field(
        foreign_key="users.id",
        nullable=False,
        index=True,
        description="The Contributor whose permissions changed.",
    )
    permission: str = Field(
        sa_column=Column(String(40), nullable=False),
        description="grade_short_answers | grade_essays",
    )
    action: str = Field(
        sa_column=Column(String(20), nullable=False),
        description="granted | revoked",
    )
    previous_value: bool = Field(
        nullable=False,
    )
    new_value: bool = Field(
        nullable=False,
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=func.now(),
        ),
    )
