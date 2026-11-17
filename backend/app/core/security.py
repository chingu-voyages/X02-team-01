from datetime import UTC, datetime, timedelta

import jwt
from pwdlib import PasswordHash

from app.core.config import settings

# Password hashing
password_hash = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(
    plain_password: str,
    hashed_password: str,
) -> bool:
    return password_hash.verify(
        plain_password,
        hashed_password,
    )


# JWT authentication
def create_access_token(subject: str) -> str:
    now = datetime.now(UTC)

    payload = {
        "sub": subject,
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
    }

    return jwt.encode(
        payload,
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )


def decode_access_token(token: str) -> str:
    payload = jwt.decode(
        token,
        settings.jwt_secret_key,
        algorithms=[settings.jwt_algorithm],
        options={"require": ["sub", "iat", "exp"]},
    )

    return payload["sub"]


def decode_access_token_issued_at(token: str) -> tuple[str, datetime]:
    """The subject plus the token's issue time (JHEP-124 AC5).

    Password reset stamps `users.sessions_invalid_before`; callers
    compare the token's `iat` against it to reject every session issued
    before the reset — stateless revocation without a token store.
    """
    payload = jwt.decode(
        token,
        settings.jwt_secret_key,
        algorithms=[settings.jwt_algorithm],
        options={"require": ["sub", "iat", "exp"]},
    )

    issued_at = datetime.fromtimestamp(payload["iat"], tz=UTC)
    return payload["sub"], issued_at


def create_access_token_for_learner(user) -> str:
    """JHEP-25: learner-scoped token with the dedicated session TTL
    (`learner_access_token_hours`, default 12 h — the default 30-minute
    token expires mid-exam). The payload carries the subject and the
    account role for JHEP-26's later enforcement checkpoint."""
    now = datetime.now(UTC)

    payload = {
        "sub": str(user.id),
        "role": user.role,
        "iat": now,
        "exp": now + timedelta(hours=settings.learner_access_token_hours),
    }

    return jwt.encode(
        payload,
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )
