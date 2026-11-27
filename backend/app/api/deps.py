from collections.abc import Callable
from datetime import UTC
from typing import Annotated
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import (
    HTTPAuthorizationCredentials,
    HTTPBearer,
)
from sqlmodel import Session

from app.core.config import settings
from app.core.roles import UserRole
from app.core.security import decode_access_token, decode_access_token_issued_at
from app.db.session import get_session
from app.models.user import User

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_subject(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(bearer_scheme),
    ],
) -> str:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        subject = decode_access_token(credentials.credentials)

        if not subject:
            raise jwt.InvalidTokenError("Missing subject")

        return subject

    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


def get_current_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(bearer_scheme),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> User:
    """Resolve the authenticated token to the trusted account record.

    JHEP-124 AC5: a token whose `iat` predates the account's
    `sessions_invalid_before` stamp (set by a password reset) is
    rejected — every pre-reset session is dead without a token store.
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        subject, issued_at = decode_access_token_issued_at(credentials.credentials)
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    # JHEP-109 AC2: a pending-MFA challenge token authorizes NOTHING
    # except /auth/mfa/verify — protected routes reject it outright.
    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
            options={"require": ["sub", "iat", "exp"]},
        )
        if payload.get("mfa") == "pending":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Multi-factor verification required",
                headers={"WWW-Authenticate": "Bearer"},
            )
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except HTTPException:
        raise

    try:
        user_id = UUID(subject)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication subject",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    user = session.get(User, user_id)

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authenticated account not found",
            headers={"WWW-Authenticate": "Bearer"},
        )

    invalid_before = user.sessions_invalid_before
    if invalid_before is not None:
        if invalid_before.tzinfo is None:
            invalid_before = invalid_before.replace(tzinfo=UTC)
        if issued_at < invalid_before:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session invalidated — please sign in again",
                headers={"WWW-Authenticate": "Bearer"},
            )

    # A confirmed enrollment is meaningful only if the current session
    # actually completed the second factor. Legacy enrolled sessions must
    # sign in again after this change; unenrolled local bootstrap accounts
    # retain the existing onboarding path.
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
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Two-factor sign-in required. Please sign in again.",
                headers={"WWW-Authenticate": "Bearer"},
            )

    return user


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

require_administrator = require_roles(
    UserRole.ADMINISTRATOR,
)
