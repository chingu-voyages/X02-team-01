from collections.abc import Callable
from datetime import UTC
from typing import Annotated
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlmodel import Session

from app.core.config import settings
from app.core.roles import UserRole
from app.core.security import decode_access_token, decode_access_token_issued_at
from app.db.session import get_session
from app.models.user import User
from app.services import mfa_service

bearer_scheme = HTTPBearer(auto_error=False)


def _unauthorized(message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=message,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _enrollment_required() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={
            "code": "MFA_ENROLLMENT_REQUIRED",
            "message": "Administrator two-factor enrollment is required. "
            "Sign in and complete Account Security setup before continuing.",
        },
    )


def get_current_subject(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> str:
    """Token-only guard for stateless logout and token contract tests."""
    if credentials is None:
        raise _unauthorized("Authentication required")
    try:
        subject = decode_access_token(credentials.credentials)
        if not subject:
            raise jwt.InvalidTokenError("Missing subject")
        return subject
    except jwt.InvalidTokenError as exc:
        raise _unauthorized("Invalid or expired authentication token") from exc


def _resolve_current_user(
    credentials: HTTPAuthorizationCredentials | None,
    session: Session,
    *,
    allow_enrollment: bool = False,
    reject_enrollment_scope: bool = False,
) -> User:
    """Authenticate and enforce current database state, revocation and MFA scope."""
    if credentials is None:
        raise _unauthorized("Authentication required")

    try:
        subject, issued_at = decode_access_token_issued_at(credentials.credentials)
        payload = jwt.decode(
            credentials.credentials,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
            options={"require": ["sub", "iat", "exp"]},
        )
    except (jwt.InvalidTokenError, OverflowError, ValueError, OSError) as exc:
        raise _unauthorized("Invalid or expired authentication token") from exc

    scope = payload.get("mfa")
    if scope == "pending" or (scope == "enrollment" and reject_enrollment_scope):
        raise _unauthorized("Multi-factor verification required")
    if scope not in (None, "enrollment"):
        raise _unauthorized("Invalid authentication token scope")

    try:
        user_id = UUID(subject)
    except (TypeError, ValueError) as exc:
        raise _unauthorized("Invalid authentication subject") from exc

    user = session.get(User, user_id, populate_existing=True)
    if user is None:
        raise _unauthorized("Authenticated account not found")

    invalid_before = user.sessions_invalid_before
    if invalid_before is not None:
        if invalid_before.tzinfo is None:
            invalid_before = invalid_before.replace(tzinfo=UTC)
        if issued_at < invalid_before:
            raise _unauthorized("Session invalidated — please sign in again")

    # An enrollment-only token is never promoted into an ordinary session,
    # even after an enrollment or role change. Its only permitted consumers
    # are the MFA enrollment/status endpoints below.
    requires_enrollment = mfa_service.administrator_requires_enrollment(user)
    if scope == "enrollment":
        if not requires_enrollment or not user.is_verified or not user.hashed_password:
            raise _unauthorized("Enrollment session is no longer valid. Sign in again.")
        if not allow_enrollment:
            raise _enrollment_required()
        return user
    if requires_enrollment:
        # Also block legacy full administrator tokens with no scope claim.
        # Require fresh password authentication before starting enrollment.
        raise _enrollment_required()

    if user.mfa_enrolled_at is not None:
        enrolled_at = user.mfa_enrolled_at
        if enrolled_at.tzinfo is None:
            enrolled_at = enrolled_at.replace(tzinfo=UTC)
        verified_at = payload.get("mfa_verified_at")
        if (
            not isinstance(verified_at, (int, float))
            or isinstance(verified_at, bool)
            or not (verified_at >= enrolled_at.timestamp())
        ):
            raise _unauthorized("Two-factor sign-in required. Please sign in again.")

    return user


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    session: Annotated[Session, Depends(get_session)],
) -> User:
    """Full authenticated account; never permits enrollment-only sessions."""
    return _resolve_current_user(credentials, session)


def get_authenticated_subject(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    session: Annotated[Session, Depends(get_session)],
) -> str:
    """Require a current full session before accessing learner content.

    Keep the existing 401 contract for restricted enrollment/challenge tokens.
    All other checks use the same database-backed resolver as admin routes.
    Staff retain their existing ability to use practice exams.
    """
    user = _resolve_current_user(credentials, session, reject_enrollment_scope=True)
    return str(user.id)


def get_current_mfa_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    session: Annotated[Session, Depends(get_session)],
) -> User:
    """Use only on MFA status, enrollment setup and enrollment confirmation."""
    return _resolve_current_user(credentials, session, allow_enrollment=True)


def require_roles(*allowed_roles: UserRole) -> Callable[..., User]:
    """Authorize users against the role stored in the trusted account record."""
    if not allowed_roles:
        raise ValueError("At least one allowed role is required")

    allowed = frozenset(role.value for role in allowed_roles)

    def role_guard(
        current_user: Annotated[User, Depends(get_current_user)],
    ) -> User:
        if current_user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return current_user

    return role_guard


require_contributor_or_administrator = require_roles(
    UserRole.CONTRIBUTOR,
    UserRole.ADMINISTRATOR,
)

require_administrator = require_roles(UserRole.ADMINISTRATOR)
