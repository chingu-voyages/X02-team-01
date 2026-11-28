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
def create_access_token(
    subject: str,
    expires_delta: timedelta | None = None,
    extra_claims: dict | None = None,
) -> str:
    now = datetime.now(UTC)

    payload = {
        "sub": subject,
        "iat": now,
        "exp": now
        + timedelta(
            minutes=(
                expires_delta.total_seconds() / 60
                if expires_delta
                else settings.access_token_expire_minutes
            )
        ),
    }
    if extra_claims:
        payload.update(extra_claims)

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

    if payload.get("mfa") in ("pending", "enrollment"):
        raise jwt.InvalidTokenError("Restricted MFA tokens are not access tokens")
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


def create_access_token_for_learner(
    user,
    *,
    authenticated_at: datetime | None = None,
    mfa_verified_at: datetime | None = None,
) -> str:
    """JHEP-25: learner-scoped token with the dedicated session TTL
    (`learner_access_token_hours`, default 12 h — the default 30-minute
    token expires mid-exam). The payload carries the subject and the
    account role for JHEP-26's later enforcement checkpoint."""
    now = datetime.now(UTC)

    payload = {
        "sub": str(user.id),
        "role": user.role,
        # Preserve sub-second precision when comparing to the account's
        # revocation cutoff. MFA sessions retain the password-challenge time,
        # so completing an old challenge cannot mint a newer session.
        "iat": (authenticated_at or now).timestamp(),
        "exp": now + timedelta(hours=settings.learner_access_token_hours),
    }
    if mfa_verified_at is not None:
        payload["mfa_verified_at"] = mfa_verified_at.timestamp()

    return jwt.encode(
        payload,
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )


def decode_mfa_challenge(token: str) -> tuple[str, str]:
    """Decode a pending-MFA challenge token (JHEP-109).

    Returns (subject, jti). Raises when the token is invalid, expired,
    or lacks the pending-MFA claim — the challenge token authorizes
    nothing else.
    """
    payload = jwt.decode(
        token,
        settings.jwt_secret_key,
        algorithms=[settings.jwt_algorithm],
        options={"require": ["sub", "iat", "exp", "mfa", "jti"]},
    )

    if payload.get("mfa") != "pending":
        raise jwt.InvalidTokenError("Not an MFA challenge token")

    return payload["sub"], payload["jti"]
