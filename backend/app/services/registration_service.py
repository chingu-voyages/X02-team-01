"""Learner self-registration (JHEP-24).

Owns: policy validation, account creation with the Learner role,
verification-token issue/activate/resend. Passwords exist only as
Argon2id hashes and never leave this service — they are neither logged
nor returned (AC3).

Policy (board-confirmed): minimum length 8, at least one uppercase, one
lowercase, one digit, maximum 128, no trimming, special characters
optional. The "alphabetic characters" row of the board table is implied
by the mandatory uppercase + lowercase checks.
"""

import hashlib
import logging
import re
import secrets
from datetime import UTC, datetime, timedelta

from sqlmodel import Session, select

from app.core.config import settings
from app.core.security import hash_password
from app.models import EmailVerificationToken, User
from app.services.email_delivery import email_sender

MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 128
VERIFY_LINK_TTL_HOURS = settings.verify_token_ttl_hours
RESEND_MIN_INTERVAL_SECONDS = settings.resend_interval_seconds


class EmailTakenError(Exception):
    """Duplicate email (AC1)."""


class WeakPasswordError(ValueError):
    """Password policy violation — message names the first failed rule."""


class RateLimitError(Exception):
    """Resend attempted faster than the configured window (AC2)."""


class InvalidVerificationTokenError(Exception):
    """The emailed link is unknown, expired, or already used (AC2)."""


def validate_password(password: str) -> None:
    """AC1 policy — one error per submission: the FIRST failed rule is
    raised so the learner fixes it one step at a time."""
    if len(password) < MIN_PASSWORD_LENGTH:
        raise WeakPasswordError("Password must be at least 8 characters")
    if len(password) > MAX_PASSWORD_LENGTH:
        raise WeakPasswordError("Password must be at most 128 characters")
    if not re.search(r"[A-Z]", password):
        raise WeakPasswordError("Password must contain an uppercase letter")
    if not re.search(r"[a-z]", password):
        raise WeakPasswordError("Password must contain a lowercase letter")
    if not re.search(r"\d", password):
        raise WeakPasswordError("Password must contain a digit")


def _token_hash(raw_token: str) -> str:
    """SHA-256 digest of the raw emailed token; the raw value never
    reaches the database."""
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _verification_link(raw_token: str) -> str:
    """T4: the link domain is the backend's own verify endpoint."""
    return f"{settings.verification_link_base}?token={raw_token}"


logger = logging.getLogger(__name__)


def _send_verification_email(*, to: str, full_name: str | None, raw_token: str) -> None:
    """Deliver the verification email, resilient to transport failures.

    A broken or refused transport (missing credentials, provider outage,
    Google throttling) must NOT turn registration into a 500: the account
    exists and is pending, and the pending-verification card's resend is
    the recovery path. Failures are logged loudly instead. A transport
    misconfigured at the SETTINGS level is still surfaced at startup by
    main.py's validation warning.
    """
    greeting = f"Welcome, {full_name}! " if full_name else ""
    body = (
        f"{greeting}Verify your account:\n"
        f"{_verification_link(raw_token)}\n\n"
        f"This link expires in {VERIFY_LINK_TTL_HOURS} hours."
    )
    try:
        email_sender().send(
            to=to,
            subject="Verify your Job Hackers account",
            body=body,
        )
    except Exception:  # noqa: BLE001 — delivery must never break registration
        logger.exception(
            "Verification email delivery FAILED for %s — the account is "
            "registered and pending; the learner can retry via resend. "
            "Check the email transport configuration (EMAIL_DELIVERY, "
            "EMAIL_SMTP_* / EMAIL_API_KEY).",
            to,
        )


class RegistrationService:
    """Create learner accounts, issue/verify one-time tokens, throttle
    resends. One session per construction; the endpoint maps domain
    errors to coded HTTP payloads."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def register(self, *, email: str, full_name: str, password: str) -> User:
        """AC1: create exactly one Learner. AC3: atomic — nothing is
        committed unless every check has passed. The verification email
        is sent AFTER commit: a mail outage must not roll back the
        account (AC3 "partially failed registration" semantics); the
        rate-limited resend covers that case."""
        validate_password(password)

        existing = self._session.exec(select(User).where(User.email == email)).first()
        if existing is not None:
            raise EmailTakenError("Email already registered")

        user = User(
            email=email,
            full_name=full_name,
            hashed_password=hash_password(password),
            role="learner",
            is_verified=False,
        )
        self._session.add(user)
        self._session.commit()
        self._session.refresh(user)

        raw_token = self._issue_token(user)
        _send_verification_email(
            to=user.email, full_name=full_name, raw_token=raw_token
        )
        return user

    def _issue_token(self, user: User) -> str:
        """Persist a hashed one-time token and stamp the resend clock.
        Returns the RAW token for the email body."""
        raw = secrets.token_urlsafe(32)
        self._session.add(
            EmailVerificationToken(
                user_id=user.id,
                token_hash=_token_hash(raw),
                expires_at=_utcnow() + timedelta(hours=VERIFY_LINK_TTL_HOURS),
            )
        )
        user.last_verification_sent_at = _utcnow()
        self._session.add(user)
        self._session.commit()
        return raw

    def activate(self, *, raw_token: str) -> User:
        """Consume the emailed one-time link (AC2). Unknown, expired, or
        already-used tokens are all safe failures of one class — no
        data probing."""
        digest = _token_hash(raw_token)
        row = self._session.exec(
            select(EmailVerificationToken).where(
                EmailVerificationToken.token_hash == digest
            )
        ).first()
        if row is None:
            raise InvalidVerificationTokenError("Verification link is invalid")
        if row.used_at is not None:
            raise InvalidVerificationTokenError("Verification link already used")
        # SQLite hands back naive expires_at; normalise to aware UTC.
        expires_at = row.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        if expires_at < _utcnow():
            raise InvalidVerificationTokenError("Verification link expired")

        row.used_at = _utcnow()
        self._session.add(row)
        user = self._session.get(User, row.user_id)
        if user is None:
            raise InvalidVerificationTokenError("Verification link is invalid")
        user.is_verified = True
        self._session.add(user)
        self._session.commit()
        self._session.refresh(user)
        return user

    def resend(self, *, email: str) -> None:
        """AC2: rate-limited resend. Generic upstream response — the
        caller never learns whether the email exists (no account
        enumeration)."""
        user = self._session.exec(select(User).where(User.email == email)).first()
        if user is None or user.is_verified:
            return  # silence: no enumeration

        if user.last_verification_sent_at is not None:
            # SQLite hands back naive datetimes; normalise to aware UTC so
            # the comparison is valid on both engines.
            sent_at = user.last_verification_sent_at
            if sent_at.tzinfo is None:
                sent_at = sent_at.replace(tzinfo=UTC)
            elapsed_seconds = (_utcnow() - sent_at).total_seconds()
            if elapsed_seconds < RESEND_MIN_INTERVAL_SECONDS:
                raise RateLimitError(
                    f"Wait {RESEND_MIN_INTERVAL_SECONDS} seconds before "
                    f"requesting another email"
                )

        raw_token = self._issue_token(user)  # previous tokens become moot
        _send_verification_email(to=user.email, full_name=None, raw_token=raw_token)
