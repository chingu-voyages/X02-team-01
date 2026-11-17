"""Self-service password recovery (JHEP-124).

AC1: `request_reset` answers identically whether or not the account
exists — one generic message, no enumeration.

AC2: the emailed challenge is time-limited (1 hour), single-use, and
stored only as a SHA-256 digest. A new request invalidates prior unused
challenges — one live challenge per account.

AC3: the new password goes through the same policy as registration
(`validate_password`).

AC4: requests are rate-limited (60 s per account, anchored on the
newest challenge); tokens are never logged and never appear in URLs
except the one-time emailed link.

AC5: a successful reset stamps `users.sessions_invalid_before`, which
`get_current_user` compares against each token's `iat` — every
pre-reset session dies without a token store. Role and ownership are
untouched.

MFA interaction (the story's risk note): no second factor is enforced
anywhere yet, so reset cannot bypass MFA today; when JHEP-109 lands it
must gate this flow.
"""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from sqlmodel import Session, select

from app.core.config import settings
from app.core.security import hash_password
from app.models import PasswordResetToken, User
from app.services.email_delivery import email_sender
from app.services.registration_service import validate_password

RESET_MIN_INTERVAL_SECONDS = settings.reset_min_interval_seconds
RESET_LINK_TTL_HOURS = settings.reset_token_ttl_hours

GENERIC_RESET_MESSAGE = (
    "If an account exists for that email, a password-reset link has been sent."
)


class InvalidResetTokenError(Exception):
    """Unknown, expired, or already-used reset challenge."""


class RateLimitError(Exception):
    """Requests are throttled per account."""


def _token_hash(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _reset_link(raw_token: str) -> str:
    base = settings.frontend_base_url.rstrip("/")
    return f"{base}/reset-password?token={raw_token}"


def request_reset(session: Session, *, email: str) -> None:
    """Generic, rate-limited, enumeration-safe reset request (AC1/AC4).

    Unknown emails return silently — the caller's response is
    byte-identical either way. Known emails get one live challenge
    (prior unused ones are invalidated) and the reset email.
    """
    normalized = email.strip().lower()
    user = session.exec(select(User).where(User.email == normalized)).first()

    if user is None:
        return  # silence: no enumeration

    # AC4: rate-limit per account, anchored on the newest challenge.
    latest = session.exec(
        select(PasswordResetToken)
        .where(PasswordResetToken.user_id == user.id)
        .order_by(PasswordResetToken.created_at.desc())
    ).first()
    if latest is not None:
        sent_at = latest.created_at
        if sent_at.tzinfo is None:
            sent_at = sent_at.replace(tzinfo=UTC)
        elapsed = (_utcnow() - sent_at).total_seconds()
        if elapsed < RESET_MIN_INTERVAL_SECONDS:
            raise RateLimitError(
                f"Wait {RESET_MIN_INTERVAL_SECONDS} seconds before "
                "requesting another reset link"
            )

    # One live challenge per account: previous unused ones are moot.
    for stale in session.exec(
        select(PasswordResetToken).where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used_at.is_(None),  # type: ignore[attr-defined]
        )
    ).all():
        stale.used_at = _utcnow()
        session.add(stale)

    raw_token = secrets.token_urlsafe(32)
    token = PasswordResetToken(
        user_id=user.id,
        token_hash=_token_hash(raw_token),
        expires_at=_utcnow() + timedelta(hours=RESET_LINK_TTL_HOURS),
    )
    session.add(token)
    session.commit()
    session.refresh(token)

    try:
        email_sender().send(
            to=user.email,
            subject="Reset your Job Hackers password",
            body=(
                f"Hi {user.full_name},\n"
                f"Reset your password:\n"
                f"{_reset_link(raw_token)}\n\n"
                f"This link works once and expires in "
                f"{RESET_LINK_TTL_HOURS} hour(s). If you didn't request "
                "a password reset, you can ignore this email — your "
                "password stays unchanged."
            ),
        )
    except Exception:  # noqa: BLE001 — delivery must never break the flow
        import logging

        logging.getLogger(__name__).exception(
            "Password-reset email delivery FAILED for %s — the challenge "
            "is issued; the learner can retry via resend after the "
            "rate-limit window.",
            user.email,
        )


def reset_password(session: Session, *, raw_token: str, new_password: str) -> User:
    """Consume the challenge and set the new credential (AC2/AC3/AC5).

    Validation order mirrors email verification: unknown hash → used →
    expired. All failures raise before any mutation; the password goes
    through the registration policy; the account's role and content are
    untouched while every pre-reset session is invalidated.
    """
    # the registration policy raises WeakPasswordError on the first
    # failed rule (one fix at a time — same messages as registration)
    validate_password(new_password)

    token = session.exec(
        select(PasswordResetToken).where(
            PasswordResetToken.token_hash == _token_hash(raw_token)
        )
    ).first()

    if token is None or token.used_at is not None:
        raise InvalidResetTokenError("This password-reset link is invalid")

    expires_at = token.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if expires_at < _utcnow():
        raise InvalidResetTokenError("This password-reset link is invalid")

    user = session.get(User, token.user_id)
    if user is None:
        raise InvalidResetTokenError("This password-reset link is invalid")

    user.hashed_password = hash_password(new_password)
    user.sessions_invalid_before = _utcnow()
    token.used_at = _utcnow()
    session.add(user)
    session.add(token)
    session.commit()
    session.refresh(user)

    return user
