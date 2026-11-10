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
VERIFY_LINK_TTL_HOURS = 24
RESEND_MIN_INTERVAL_SECONDS = 60


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


class RegistrationService:
    """Create learner accounts, issue/verify one-time tokens, throttle
    resends. One session per construction; the endpoint maps domain
    errors to coded HTTP payloads."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def register(self, *, email: str, password: str) -> User:
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
            hashed_password=hash_password(password),
            role="learner",
            is_verified=False,
        )
        self._session.add(user)
        self._session.commit()
        self._session.refresh(user)

        raw_token = self._issue_token(user)
        email_sender().send(
            to=user.email,
            subject="Verify your Job Hackers account",
            body=(
                f"Welcome! Verify your account:\n"
                f"{_verification_link(raw_token)}\n\n"
                f"This link expires in {VERIFY_LINK_TTL_HOURS} hours."
            ),
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
        if row.expires_at < _utcnow():
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
            elapsed_seconds = (
                _utcnow() - user.last_verification_sent_at
            ).total_seconds()
            if elapsed_seconds < RESEND_MIN_INTERVAL_SECONDS:
                raise RateLimitError(
                    f"Wait {RESEND_MIN_INTERVAL_SECONDS} seconds before "
                    f"requesting another email"
                )

        raw_token = self._issue_token(user)  # previous tokens become moot
        email_sender().send(
            to=user.email,
            subject="Verify your Job Hackers account",
            body=(
                f"Verify your account:\n{_verification_link(raw_token)}\n\n"
                f"This link expires in {VERIFY_LINK_TTL_HOURS} hours."
            ),
        )
