"""Learner authentication endpoints (JHEP-24 + JHEP-25).

Registration/verification (JHEP-24):
- POST /auth/register — create one Learner account (AC1), start the
  verification email flow (AC2). Top-level coded errors: EMAIL_TAKEN 409,
  WEAK_PASSWORD 422 (JHEP-99 form-compat: `data.message` reads the text).
- GET  /auth/verify?token=… — consume the emailed one-time link (AC2):
  flips is_verified once; invalid/used/expired → INVALID_OR_EXPIRED_TOKEN
  400.
- POST /auth/resend-verification — rate-limited (AC2), generic response
  so the endpoint never reveals whether an email exists.

Login/logout (JHEP-25):
- POST /auth/login — verify credentials against the Argon2id hash and
  issue a learner-scoped JWT. Unknown email, wrong password, and
  hash-less accounts all return the SAME generic 401 (no enumeration);
  unverified accounts get a distinct coded 403.
- POST /auth/logout — stateless semantics: the client discards the
  token; the JWT expiry is the server-side bound (a server-side
  invalidation store is a documented follow-up).

Password/credential handling (AC3): passwords exist only as Argon2id
hashes and never leave the service; tokens are never logged by this
module.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
from sqlalchemy import func
from sqlmodel import Session, select

from app.api.deps import get_current_subject
from app.core.config import settings
from app.core.security import (
    create_access_token_for_learner,
    verify_password,
)
from app.db.session import get_session
from app.models import User
from app.schemas.auth import (
    AuthTokenOut,
    LearnerLoginIn,
    LearnerOut,
    ResendVerificationIn,
    UserRegistrationIn,
)
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


def _learner_out(user: User) -> LearnerOut:
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


@router.get("/verify")
def verify(
    token: str,
    service: Annotated[RegistrationService, Depends(get_registration_service)],
) -> RedirectResponse:
    """Consume the emailed one-time activation link (AC2).

    The link is opened by a human in a browser, so both outcomes land on
    the login screen: `?verified=1` on success, `?verification=invalid`
    for unknown/expired/already-used tokens.
    """
    login_screen = f"{settings.frontend_base_url}/login"
    try:
        service.activate(raw_token=token)
    except InvalidVerificationTokenError:
        return RedirectResponse(
            f"{login_screen}?verification=invalid",
            status_code=status.HTTP_303_SEE_OTHER,
        )

    return RedirectResponse(
        f"{login_screen}?verified=1",
        status_code=status.HTTP_303_SEE_OTHER,
    )


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


@router.post("/login", response_model=AuthTokenOut)
def login(
    payload: LearnerLoginIn,
    session: Annotated[Session, Depends(get_session)],
) -> AuthTokenOut:
    """AC1: establish an authenticated learner session.

    Unknown email, wrong password, and hash-less accounts all produce the
    SAME generic 401 (no account enumeration). Unverified accounts get a
    distinct coded 403 guiding them to their pending verification email.
    """
    user = session.exec(
        select(User).where(func.lower(User.email) == payload.email.lower().strip())
    ).first()

    if user is None or user.hashed_password is None:
        raise CodedAuthError(
            status.HTTP_401_UNAUTHORIZED,
            "INVALID_CREDENTIALS",
            "Invalid email or password",
        )

    if not verify_password(payload.password, user.hashed_password):
        raise CodedAuthError(
            status.HTTP_401_UNAUTHORIZED,
            "INVALID_CREDENTIALS",
            "Invalid email or password",
        )

    if not user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "ACCOUNT_NOT_VERIFIED",
                "message": "Verify your email before signing in — the "
                "verification link was sent to your address.",
            },
        )

    access_token = create_access_token_for_learner(user)

    return AuthTokenOut(
        access_token=access_token,
        token_type="bearer",
        learner=_learner_out(user),
    )


@router.post("/logout", status_code=status.HTTP_200_OK)
def logout(
    subject: Annotated[str, Depends(get_current_subject)],
) -> dict:
    """AC2: stateless logout — the client discards the token.

    JWT expiry is the server-side bound for stale credentials; a
    server-side invalidation store is a documented follow-up.
    """
    from datetime import UTC, datetime

    return {
        "message": "Logged out",
        "logged_out_at": datetime.now(UTC).isoformat(),
    }
