"""Learner registration and verification contracts (JHEP-24)."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import (
    AliasChoices,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
)

from app.services.registration_service import MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH


class UserRegistrationIn(BaseModel):
    """Shape only; the password POLICY lives in the registration service.

    JHEP-99 compatibility: the wireframe form posts `fullName` (camelCase),
    while the contract's canonical key is `full_name` (snake_case). Both
    are accepted; `extra="forbid"` keeps every other key rejected.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )

    email: EmailStr

    # AC1: display name — required, whitespace-trimmed server-side, 1-255.
    full_name: str = Field(
        min_length=1,
        max_length=255,
        validation_alias=AliasChoices("full_name", "fullName"),
    )

    password: str = Field(
        min_length=MIN_PASSWORD_LENGTH,
        max_length=MAX_PASSWORD_LENGTH,
    )

    @field_validator("full_name")
    @classmethod
    def strip_and_validate(cls, value: str) -> str:
        stripped = value.strip()
        if len(stripped) < 1:
            raise ValueError("Full name must not be empty")
        return stripped


class LearnerOut(BaseModel):
    """Never contains a password or hash (AC3 audit).

    JHEP-99 compatibility: the response serialises the display name as
    `fullName` (the wireframe form's key); internal code keeps using
    `full_name`.
    """

    model_config = ConfigDict(populate_by_name=True)

    id: UUID
    email: str
    full_name: str = Field(serialization_alias="fullName")
    role: Literal["learner", "contributor", "administrator"]
    is_verified: bool
    status: Literal["pending_verification", "verified"]
    created_at: datetime


class ResendVerificationIn(BaseModel):
    """Email payload for the rate-limited verification resend endpoint."""

    model_config = ConfigDict(extra="forbid")

    email: EmailStr


# --- JHEP-25: login/logout contracts ---


class LearnerLoginIn(BaseModel):
    """Credentials for the login endpoint; shape only — the generic-401
    rule lives in the endpoint (no enumeration).

    Email is a plain string (not EmailStr): login matches the stored
    value case-insensitively; format validation happened at registration.
    """

    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)


class AuthTokenOut(BaseModel):
    """The OAuth2-ish token response consumed by the merged AuthProvider
    (`setToken(data.access_token)`); the embedded learner mirrors
    `LearnerOut` (serialised as `fullName` for the JHEP-99 form)."""

    access_token: str
    token_type: Literal["bearer"]
    learner: LearnerOut
