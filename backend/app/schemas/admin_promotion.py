"""Explicit, high-privilege administrator promotion (JHEP-207)."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, StrictBool, StringConstraints

from app.schemas.admin_user import AdminUserOut


class AdministratorPromotionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    confirmation_email: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)
    ]
    confirm: StrictBool
    reason: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)
    ]


class PromotionIssue(BaseModel):
    code: str
    message: str


class AdministratorPromotionEligibility(BaseModel):
    target: AdminUserOut
    mfa_enrolled: bool
    eligible: bool
    issues: list[PromotionIssue]
    recent_authentication: bool
    authentication_max_age_seconds: int


class AdministratorPromotionOut(BaseModel):
    user: AdminUserOut
    audit_id: UUID
    action: Literal["promoted"] = "promoted"
    role_before: Literal["contributor"] = "contributor"
    role_after: Literal["administrator"] = "administrator"
    changed_at: datetime
    previous_privileged_sessions_revoked: Literal[True] = True
