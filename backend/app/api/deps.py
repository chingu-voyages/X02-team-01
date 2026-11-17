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
        subject, issued_at = decode_access_token_issued_at(
            credentials.credentials
        )
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

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
