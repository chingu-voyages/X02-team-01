"""Admin Users & Access payloads (JHEP-125).

Response models never serialise a password hash. Role changes accept
only `learner` and `contributor` — elevating an account to
`administrator` through this screen is forbidden by the story (the
initial Administrator is seeded through a separate protected
provisioning route, which is its own story).
"""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class AdminUserOut(BaseModel):
    """One account as the Users & Access screen sees it."""

    model_config = ConfigDict(populate_by_name=True)

    id: UUID
    email: str
    full_name: str = Field(serialization_alias="fullName")
    role: Literal["learner", "contributor", "administrator"]
    is_verified: bool
    grade_short_answers: bool = False
    grade_essays: bool = False
    created_at: datetime


class UsersPageOut(BaseModel):
    """A list/search page of accounts (stable email ordering)."""

    items: list[AdminUserOut]
    total: int
    limit: int
    offset: int


class UserRoleChangeIn(BaseModel):
    """The requested role for an existing account.

    Only the Learner<->Contributor transitions are legal here; this
    screen can never elevate an account to Administrator.
    """

    role: Literal["learner", "contributor"]


class UserRoleChangeOut(BaseModel):
    """The changed account plus the before/after audit metadata."""

    user: AdminUserOut
    action: Literal["promoted", "revoked"]
    role_before: str
    role_after: str
    changed_at: datetime


class GradingPermissionsUpdateIn(BaseModel):
    """JHEP-192: the two independent grading-permission flags. Omitted
    fields keep their current values (a partial save never zeroes the
    other flag)."""

    grade_short_answers: bool | None = None
    grade_essays: bool | None = None


class GradingPermissionsChangeOut(BaseModel):
    """The updated account plus the applied audit rows (AC5)."""

    user: AdminUserOut
    changes: list[dict]
