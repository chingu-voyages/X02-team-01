"""Learner registration and verification contracts (JHEP-24)."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.services.registration_service import MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH


class UserRegistrationIn(BaseModel):
    """Shape only; the password POLICY lives in the registration service."""

    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: str = Field(
        min_length=MIN_PASSWORD_LENGTH,
        max_length=MAX_PASSWORD_LENGTH,
    )


class LearnerOut(BaseModel):
    """Never contains a password or hash (AC3 audit)."""

    id: UUID
    email: str
    role: Literal["learner", "contributor", "administrator"]
    is_verified: bool
    status: Literal["pending_verification", "verified"]
    created_at: datetime


class ResendVerificationIn(BaseModel):
    """Email payload for the rate-limited verification resend endpoint."""

    model_config = ConfigDict(extra="forbid")

    email: EmailStr
