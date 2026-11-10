"""Learner self-registration and account verification (JHEP-24).

Endpoints:
- POST /auth/register — create one Learner account (AC1), start the
  verification email flow (AC2). Top-level coded errors: EMAIL_TAKEN 409,
  WEAK_PASSWORD 422 (JHEP-99 form-compat: `data.message` reads the text).
- GET  /auth/verify?token=… — consume the emailed one-time link (AC2):
  flips is_verified once; invalid/used/expired → INVALID_OR_EXPIRED_TOKEN
  400.
- POST /auth/resend-verification — rate-limited (AC2), generic response
  so the endpoint never reveals whether an email exists.

Password/credential handling (AC3): the Argon2id hash is written only
inside the registration service and never returned, echoed or logged by
this module.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlmodel import Session

from app.db.session import get_session
from app.schemas.auth import LearnerOut, ResendVerificationIn, UserRegistrationIn
from app.services.registration_service import (
    EmailTakenError,
    InvalidVerificationTokenError,
    RateLimitError,
    RegistrationService,
    WeakPasswordError,
)


class CodedAuthError(Exception):
    """Auth-family stop carrying a TOP-LEVEL {code, message} body.

    JHEP-99 form compatibility: the RegisterForm reads `data.message`,
    so auth error bodies are emitted as {"code", "message"} rather than
    the {"detail": {...}} wrapper the exam endpoints use. Scoped to the
    /auth family via the registered handler in main.py.
    """

    def __init__(self, status_code: int, code: str, message: str) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message
        super().__init__(f"{code}: {message}")


router = APIRouter()


def get_registration_service(
    session: Annotated[Session, Depends(get_session)],
) -> RegistrationService:
    """One request-scoped database session for the whole registration."""
    return RegistrationService(session)


def _learner_out(user) -> LearnerOut:
    """Confirmed response shape (serialised as `fullName` for the JHEP-99
    form); never any password or hash."""
    return LearnerOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        is_verified=user.is_verified,
        status="verified" if user.is_verified else "pending_verification",
        created_at=user.created_at,
    )


@router.post(
    "/register",
    response_model=LearnerOut,
    status_code=status.HTTP_201_CREATED,
)
def register(
    payload: UserRegistrationIn,
    service: Annotated[RegistrationService, Depends(get_registration_service)],
) -> LearnerOut:
    """Create one learner account and start email verification (AC1/AC2)."""
    try:
        user = service.register(
            email=str(payload.email),
            full_name=payload.full_name.strip(),
            password=payload.password,
        )
    except WeakPasswordError as exc:
        raise CodedAuthError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "WEAK_PASSWORD",
            str(exc),
        ) from exc
    except EmailTakenError as exc:
        raise CodedAuthError(
            status.HTTP_409_CONFLICT,
            "EMAIL_TAKEN",
            str(exc),
        ) from exc

    return _learner_out(user)


@router.get("/verify", response_model=LearnerOut)
def verify(
    token: str,
    service: Annotated[RegistrationService, Depends(get_registration_service)],
) -> LearnerOut:
    """Consume the emailed one-time activation link (AC2)."""
    try:
        user = service.activate(raw_token=token)
    except InvalidVerificationTokenError as exc:
        raise CodedAuthError(
            status.HTTP_400_BAD_REQUEST,
            "INVALID_OR_EXPIRED_TOKEN",
            str(exc),
        ) from exc

    return _learner_out(user)


@router.post("/resend-verification", status_code=status.HTTP_200_OK)
def resend_verification(
    payload: ResendVerificationIn,
    service: Annotated[RegistrationService, Depends(get_registration_service)],
) -> dict:
    """Rate-limited resend; generic response (no account enumeration)."""
    try:
        service.resend(email=str(payload.email))
    except RateLimitError as exc:
        raise CodedAuthError(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "RATE_LIMITED",
            str(exc),
        ) from exc

    return {
        "message": "If the account exists and is unverified, a verification "
        "email has been sent."
    }
