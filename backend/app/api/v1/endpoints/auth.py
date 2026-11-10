"""Learner self-registration and account verification (JHEP-24).

Endpoints:
- POST /auth/register — create one Learner account (AC1), start the
  verification email flow (AC2). Coded errors: EMAIL_TAKEN 409,
  WEAK_PASSWORD 422.
- GET  /auth/verify?token=… — consume the emailed one-time link (AC2):
  flips is_verified once; invalid/used/expired → INVALID_OR_EXPIRED_TOKEN 400.
- POST /auth/resend-verification — rate-limited (AC2), generic response
  so the endpoint never reveals whether an email exists.

Password/credential handling (AC3): the Argon2id hash is written only
inside the registration service and never returned, echoed or logged by
this module.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
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

router = APIRouter()


def get_registration_service(
    session: Annotated[Session, Depends(get_session)],
) -> RegistrationService:
    """One request-scoped database session for the whole registration."""
    return RegistrationService(session)


def _learner_out(user) -> LearnerOut:
    """Confirmed response shape: pending-verification learner, never any
    password or hash."""
    return LearnerOut(
        id=user.id,
        email=user.email,
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
        user = service.register(email=str(payload.email), password=payload.password)
    except WeakPasswordError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "WEAK_PASSWORD", "message": str(exc)},
        ) from exc
    except EmailTakenError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "EMAIL_TAKEN", "message": str(exc)},
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
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_OR_EXPIRED_TOKEN", "message": str(exc)},
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
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "RATE_LIMITED", "message": str(exc)},
        ) from exc

    return {
        "message": "If the account exists and is unverified, a verification "
        "email has been sent."
    }
