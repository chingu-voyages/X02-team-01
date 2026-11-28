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

from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import UUID

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import func
from sqlmodel import Session, select

from app.api.deps import (
    bearer_scheme,
    get_current_mfa_user,
    get_current_subject,
    require_contributor_or_administrator,
)
from app.core.config import settings
from app.core.security import (
    create_access_token,
    create_access_token_for_learner,
    decode_mfa_challenge,
    verify_password,
)
from app.db.session import get_session
from app.models import User
from app.schemas.auth import (
    AuthTokenOut,
    LearnerLoginIn,
    LearnerOut,
    PasswordResetIn,
    PasswordResetRequestIn,
    ResendVerificationIn,
    UserRegistrationIn,
)
from app.schemas.manual_grading import GradingPermissionsOut
from app.services import mfa_service
from app.services.admin_user_service import can_grade_response_type
from app.services.mfa_service import (
    ChallengeLockedError,
    EnrollmentNotAllowedError,
    InvalidMfaCodeError,
    MfaAlreadyEnrolledError,
    MfaNotConfiguredError,
    MfaNotEnrolledError,
    begin_challenge,
    mfa_required_for,
)
from app.services.password_reset_service import (
    GENERIC_RESET_MESSAGE,
    InvalidResetTokenError,
    SamePasswordError,
    request_reset,
    reset_password,
)
from app.services.password_reset_service import (
    RateLimitError as ResetRateLimitError,
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


def get_password_reset_service(
    session: Annotated[Session, Depends(get_session)],
) -> None:
    """The password-reset service functions are module-level; this
    provider exists so the reset endpoints share the request-scoped
    session dependency with the rest of the auth surface."""
    return None


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
        select(User)
        .where(func.lower(User.email) == payload.email.lower().strip())
        .with_for_update()
        .execution_options(populate_existing=True)
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

    # JHEP-207: password authentication alone must never grant an
    # unenrolled Administrator a normal access token. The scope is also
    # enforced by the server; the response flag only drives navigation.
    if mfa_service.administrator_requires_enrollment(user):
        enrollment_token = create_access_token(
            subject=str(user.id),
            expires_delta=timedelta(minutes=15),
            extra_claims={
                "mfa": "enrollment",
                "role": user.role,
                "iat": datetime.now(UTC).timestamp(),
            },
        )
        return AuthTokenOut(
            access_token=enrollment_token,
            token_type="bearer",
            learner=_learner_out(user),
            mfa_enrollment_required=True,
            mfa_expires_in_seconds=900,
        )

    # JHEP-109 AC2: an MFA-required account must complete the second
    # factor before ANY session is established — the challenge token
    # authorizes nothing but /auth/mfa/verify.
    if mfa_required_for(user):
        payload, challenge_id = begin_challenge(session, user=user)
        challenge_token = create_access_token(
            subject=str(user.id),
            expires_delta=timedelta(minutes=settings.mfa_challenge_minutes),
            extra_claims={"mfa": "pending", "jti": challenge_id},
        )
        return AuthTokenOut(
            access_token=challenge_token,
            token_type="bearer",
            learner=_learner_out(user),
            mfa_required=True,
            challenge_id=challenge_id,
            mfa_expires_in_seconds=payload["expires_in_seconds"],
        )

    return AuthTokenOut(
        access_token=create_access_token_for_learner(user),
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
    return {
        "message": "Logged out",
        "logged_out_at": datetime.now(UTC).isoformat(),
    }


@router.post("/forgot-password", status_code=status.HTTP_200_OK)
def forgot_password(
    payload: PasswordResetRequestIn,
    session: Annotated[Session, Depends(get_session)],
) -> dict:
    """JHEP-124 AC1/AC4: generic, rate-limited, enumeration-safe."""
    try:
        request_reset(session, email=str(payload.email))
    except ResetRateLimitError as exc:
        raise CodedAuthError(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "RATE_LIMITED",
            str(exc),
        ) from exc

    return {"message": GENERIC_RESET_MESSAGE}


@router.post("/reset-password", status_code=status.HTTP_200_OK)
def reset_account_password(
    payload: PasswordResetIn,
    session: Annotated[Session, Depends(get_session)],
) -> dict:
    """JHEP-124 AC2/AC3/AC5: consume the one-time challenge, set the new
    credential under the registration policy, and invalidate every
    pre-reset session."""
    try:
        reset_password(
            session,
            raw_token=payload.token,
            new_password=payload.new_password,
        )
    except InvalidResetTokenError as exc:
        raise CodedAuthError(
            status.HTTP_400_BAD_REQUEST,
            "INVALID_OR_EXPIRED_RESET_TOKEN",
            str(exc),
        ) from exc
    except WeakPasswordError as exc:
        raise CodedAuthError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "WEAK_PASSWORD",
            str(exc),
        ) from exc
    except SamePasswordError as exc:
        raise CodedAuthError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "PASSWORD_UNCHANGED",
            str(exc),
        ) from exc

    return {"message": "Password updated. Sign in with your new password."}


def get_mfa_context(
    session: Annotated[Session, Depends(get_session)],
) -> None:
    """The MFA service functions are module-level; this provider keeps
    the endpoints on the request-scoped session dependency."""
    return None


@router.post("/mfa/enroll/setup", status_code=status.HTTP_200_OK)
def mfa_enroll_setup(
    current_user: Annotated[User, Depends(get_current_mfa_user)],
    session: Annotated[Session, Depends(get_session)],
) -> dict:
    """JHEP-109 AC1: start TOTP enrollment — the secret (encrypted at
    rest) plus the provisioning URI the frontend renders as a QR."""
    from app.services import mfa_service

    try:
        setup = mfa_service.begin_enrollment(session, actor=current_user)
    except MfaAlreadyEnrolledError as exc:
        raise CodedAuthError(
            status.HTTP_409_CONFLICT, "MFA_ALREADY_ENROLLED", str(exc)
        ) from exc
    except EnrollmentNotAllowedError as exc:
        raise CodedAuthError(
            status.HTTP_403_FORBIDDEN, "MFA_NOT_AVAILABLE", str(exc)
        ) from exc
    except MfaNotConfiguredError as exc:
        raise CodedAuthError(
            status.HTTP_503_SERVICE_UNAVAILABLE, "MFA_NOT_CONFIGURED", str(exc)
        ) from exc

    return {
        "otpauth_uri": setup["otpauth_uri"],
        "secret": setup["secret"],
        "issuer": "The Job Hackers",
    }


@router.post("/mfa/enroll/verify", status_code=status.HTTP_200_OK)
def mfa_enroll_verify(
    payload: dict,
    current_user: Annotated[User, Depends(get_current_mfa_user)],
    session: Annotated[Session, Depends(get_session)],
) -> dict:
    """JHEP-109 AC1: confirm the enrollment with a live code; the
    recovery codes are returned ONCE (only digests are stored)."""
    from app.services import mfa_service

    code = str(payload.get("code") or "")
    if not code:
        raise CodedAuthError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "VALIDATION_ERROR",
            "The 6-digit code is required",
        )
    try:
        result = mfa_service.confirm_enrollment(session, actor=current_user, code=code)
    except EnrollmentNotAllowedError as exc:
        raise CodedAuthError(
            status.HTTP_403_FORBIDDEN, "MFA_NOT_AVAILABLE", str(exc)
        ) from exc
    except MfaNotEnrolledError as exc:
        raise CodedAuthError(
            status.HTTP_409_CONFLICT, "MFA_NOT_ENROLLED", str(exc)
        ) from exc
    except MfaAlreadyEnrolledError as exc:
        raise CodedAuthError(
            status.HTTP_409_CONFLICT, "MFA_ALREADY_ENROLLED", str(exc)
        ) from exc
    except MfaNotConfiguredError as exc:
        raise CodedAuthError(
            status.HTTP_503_SERVICE_UNAVAILABLE, "MFA_NOT_CONFIGURED", str(exc)
        ) from exc
    except InvalidMfaCodeError as exc:
        raise CodedAuthError(
            status.HTTP_400_BAD_REQUEST, "INVALID_MFA_CODE", str(exc)
        ) from exc

    return {
        "message": "MFA enabled. Store your recovery codes safely — they "
        "are shown once and never again.",
        "recovery_codes": result["recovery_codes"],
    }


@router.post("/mfa/verify", status_code=status.HTTP_200_OK)
def mfa_verify(
    payload: dict,
    session: Annotated[Session, Depends(get_session)],
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> AuthTokenOut:
    """JHEP-109 AC2/AC5: complete the second factor; only then is the
    real session established."""
    from app.services import mfa_service

    code = str(payload.get("code") or "")
    use_recovery = bool(payload.get("recovery_code"))
    if not code:
        raise CodedAuthError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "VALIDATION_ERROR",
            "The 6-digit code is required",
        )

    if credentials is None:
        raise CodedAuthError(
            status.HTTP_401_UNAUTHORIZED,
            "INVALID_MFA_CHALLENGE",
            "Start again with your email and password",
        )

    try:
        subject, challenge_id = decode_mfa_challenge(credentials.credentials)
    except jwt.InvalidTokenError as exc:
        raise CodedAuthError(
            status.HTTP_401_UNAUTHORIZED,
            "INVALID_MFA_CHALLENGE",
            "Start again with your email and password",
        ) from exc

    try:
        user_id = UUID(subject)
    except (TypeError, ValueError) as exc:
        raise CodedAuthError(
            status.HTTP_401_UNAUTHORIZED,
            "INVALID_MFA_CHALLENGE",
            "Start again with your email and password",
        ) from exc
    user = session.get(User, user_id)
    if user is None:
        raise CodedAuthError(
            status.HTTP_401_UNAUTHORIZED,
            "INVALID_MFA_CHALLENGE",
            "Start again with your email and password",
        )

    try:
        if use_recovery:
            authenticated_at = mfa_service.verify_recovery_code(
                session, user=user, challenge_id=challenge_id, code=code
            )
        else:
            authenticated_at = mfa_service.verify_challenge(
                session, user=user, challenge_id=challenge_id, code=code
            )
    except InvalidMfaCodeError as exc:
        raise CodedAuthError(
            status.HTTP_400_BAD_REQUEST, "INVALID_MFA_CODE", str(exc)
        ) from exc
    except ChallengeLockedError as exc:
        raise CodedAuthError(
            status.HTTP_403_FORBIDDEN, "MFA_CHALLENGE_LOCKED", str(exc)
        ) from exc
    except (MfaNotEnrolledError, MfaNotConfiguredError) as exc:
        raise CodedAuthError(
            status.HTTP_409_CONFLICT, "MFA_NOT_AVAILABLE", str(exc)
        ) from exc

    token = create_access_token_for_learner(
        user,
        authenticated_at=authenticated_at,
        mfa_verified_at=datetime.now(UTC),
    )
    return AuthTokenOut(
        access_token=token,
        token_type="bearer",
        learner=_learner_out(user),
    )


@router.get("/mfa/status", status_code=status.HTTP_200_OK)
def mfa_status(
    current_user: Annotated[User, Depends(get_current_mfa_user)],
) -> dict:
    """JHEP-109: the account's MFA posture — drives the Security page
    and the forced-enrollment prompt for mandatory roles."""
    from app.services import mfa_service

    return {
        "configured": mfa_service.mfa_configured(),
        "available": mfa_service.mfa_available_for(current_user),
        "mandatory": current_user.role in mfa_service.MFA_MANDATORY_ROLES,
        "enrolled": current_user.mfa_enrolled_at is not None,
    }


@router.get("/grading-permissions", response_model=GradingPermissionsOut)
def grading_permissions(
    actor: Annotated[User, Depends(require_contributor_or_administrator)],
) -> GradingPermissionsOut:
    """JHEP-192/JHEP-122: the signed-in reviewer's own permitted types.

    Flags are read from the database row on every request, so a revocation
    takes effect immediately without a token refresh (AC8).
    """
    return GradingPermissionsOut(
        short_answer=can_grade_response_type(actor, "short_answer"),
        essay=can_grade_response_type(actor, "essay"),
    )
