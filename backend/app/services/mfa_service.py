"""TOTP multi-factor authentication (JHEP-109).

Design guarantees:
- Dormant by default: nothing changes for accounts that have not
  enrolled (`mfa_enrolled_at` null) — the login response is identical.
- Role policy (PO-confirmed): Administrators MUST enroll; Contributors
  MAY; Learners are not offered enrollment.
- The secret is Fernet-encrypted at rest with MFA_ENCRYPTION_KEY; that
  key is optional at startup (the R2-style graceful pattern) — without
  it the service raises MfaNotConfiguredError and the endpoints return
  a clean error while the rest of the app runs.
- Codes are verified with pyotp (RFC 6238, ±1 window drift) — no custom
  cryptography.
- Sign-in challenges are stateful rows (the challenge JWT carries the
  row id as its `jti`) so failed attempts can be counted and a challenge
  locked after mfa_max_attempts (AC3) — stateless tokens cannot count.
- Recovery codes are single-use, stored only as SHA-256 digests, and
  shown ONCE in plaintext at enrollment (AC4/PO decision).
- AC4: password reset never bypasses MFA — reset only changes the
  credential; the next login still challenges (tested).
"""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

import pyotp
from cryptography.fernet import Fernet
from sqlmodel import Session, select

from app.core.config import settings
from app.core.roles import UserRole
from app.models import MfaLoginChallenge, MfaRecoveryCode, User

# PO-confirmed role policy (JHEP-108/JHEP-109)
MFA_MANDATORY_ROLES = {UserRole.ADMINISTRATOR.value}
MFA_OPTIONAL_ROLES = {UserRole.CONTRIBUTOR.value}
# Learners are not offered enrollment initially.


class MfaNotConfiguredError(Exception):
    """MFA_ENCRYPTION_KEY is missing — MFA is disabled."""


class MfaNotEnrolledError(Exception):
    """The account has no confirmed TOTP enrollment."""


class MfaAlreadyEnrolledError(Exception):
    """The account already has a confirmed enrollment."""


class InvalidMfaCodeError(Exception):
    """The code is wrong, the challenge expired, or attempts ran out."""


class ChallengeLockedError(Exception):
    """Too many failed attempts — the challenge is dead; re-login."""


class EnrollmentNotAllowedError(Exception):
    """The account's role is outside the enrollment policy."""


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _fernet() -> Fernet:
    if not settings.mfa_encryption_key:
        raise MfaNotConfiguredError(
            "MFA is not configured on this deployment (missing MFA_ENCRYPTION_KEY)"
        )
    # Derive a Fernet key from the deployment secret without storing it
    digest = hashlib.sha256(settings.mfa_encryption_key.encode("utf-8")).digest()
    return Fernet(_b64(digest))


def _b64(raw: bytes) -> bytes:
    import base64

    return base64.urlsafe_b64encode(raw)


def mfa_configured() -> bool:
    try:
        _fernet()
    except MfaNotConfiguredError:
        return False
    return True


def _decrypt_secret(encrypted: str) -> str:
    return _fernet().decrypt(encrypted.encode("utf-8")).decode("utf-8")


def mfa_required_for(user: User) -> bool:
    """Whether this account must complete MFA at sign-in (PO policy)."""
    return user.role in MFA_MANDATORY_ROLES and user.mfa_enrolled_at is not None


def mfa_available_for(user: User) -> bool:
    """Whether the account MAY enroll (the policy's optional set)."""
    return user.role in MFA_MANDATORY_ROLES or user.role in MFA_OPTIONAL_ROLES


def begin_enrollment(session: Session, *, actor: User) -> dict:
    """Generate (or re-generate) an unconfirmed secret + provisioning
    data. Re-generation invalidates any prior unconfirmed secret."""
    if not mfa_available_for(actor):
        raise EnrollmentNotAllowedError("MFA enrollment is not available for this role")
    if not mfa_configured():
        raise MfaNotConfiguredError("MFA is not configured on this deployment")

    secret = pyotp.random_base32()
    encrypted = _fernet().encrypt(secret.encode("utf-8")).decode("utf-8")
    actor.totp_secret_encrypted = encrypted
    session.add(actor)
    session.commit()

    totp = pyotp.TOTP(secret)
    uri = totp.provisioning_uri(name=actor.email, issuer_name="The Job Hackers")
    return {"secret": secret, "otpauth_uri": uri}


def _verify_code(secret: str, code: str) -> bool:
    totp = pyotp.TOTP(secret)
    return totp.verify(code.strip(), valid_window=1)


def confirm_enrollment(session: Session, *, actor: User, code: str) -> dict:
    """Verify a live code against the unconfirmed secret; activate
    enrollment and issue the one-time recovery codes."""
    if not actor.totp_secret_encrypted:
        raise MfaNotEnrolledError("Start enrollment first (request the setup data)")
    if actor.mfa_enrolled_at is not None:
        raise MfaAlreadyEnrolledError("MFA is already enabled on this account")

    secret = _decrypt_secret(actor.totp_secret_encrypted)
    if not _verify_code(secret, code):
        raise InvalidMfaCodeError(
            "That code didn't match. Check your authenticator and try again."
        )

    actor.mfa_enrolled_at = _utcnow()
    session.add(actor)

    plaintext_codes: list[str] = []
    for _ in range(settings.mfa_recovery_code_count):
        raw = secrets.token_hex(5).upper()  # e.g. 4F7A2B91C0
        plaintext_codes.append(raw)
        session.add(
            MfaRecoveryCode(
                user_id=actor.id,
                code_hash=hashlib.sha256(raw.encode("utf-8")).hexdigest(),
            )
        )
    session.commit()
    session.refresh(actor)

    return {"recovery_codes": plaintext_codes}


def begin_challenge(session: Session, *, user: User) -> tuple[dict, str]:
    """Create the sign-in challenge row; return (payload, challenge_id).

    The login endpoint embeds the challenge id in the short-lived
    challenge token (its jti)."""
    expires_at = _utcnow() + timedelta(minutes=settings.mfa_challenge_minutes)
    challenge = MfaLoginChallenge(
        user_id=user.id,
        created_at=_utcnow(),
        expires_at=expires_at,
    )
    session.add(challenge)
    session.commit()
    session.refresh(challenge)

    return (
        {
            "mfa_required": True,
            "challenge_id": str(challenge.id),
            "expires_in_seconds": int((expires_at - _utcnow()).total_seconds()),
        },
        str(challenge.id),
    )


def verify_challenge(
    session: Session, *, user: User, challenge_id: str, code: str
) -> None:
    """Validate the challenge and the code (AC3/AC5).

    The challenge row counts failed attempts and locks after
    mfa_max_attempts; success marks it consumed. Raises on any failure —
    the caller decides the response; the full session is granted
    elsewhere only when this returns.
    """
    challenge = session.get(MfaLoginChallenge, _uuid_or_none(challenge_id))
    if challenge is None or challenge.user_id != user.id or challenge.consumed:
        raise InvalidMfaCodeError("That sign-in challenge is invalid. Start again.")

    expires_at = challenge.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if expires_at < _utcnow():
        raise InvalidMfaCodeError("That sign-in challenge has expired. Start again.")

    if challenge.failed_attempts >= settings.mfa_max_attempts:
        raise ChallengeLockedError(
            "Too many incorrect attempts. Sign in again to get a fresh challenge."
        )

    if not user.totp_secret_encrypted or user.mfa_enrolled_at is None:
        raise MfaNotEnrolledError("This account has no confirmed MFA enrollment")

    secret = _decrypt_secret(user.totp_secret_encrypted)
    code = code.strip()

    if _verify_code(secret, code):
        challenge.consumed = True
        session.add(challenge)
        session.commit()
        return

    challenge.failed_attempts += 1
    session.add(challenge)
    session.commit()

    if challenge.failed_attempts >= settings.mfa_max_attempts:
        raise ChallengeLockedError(
            "Too many incorrect attempts. Sign in again to get a fresh challenge."
        )
    raise InvalidMfaCodeError(
        "That code didn't match. Check your authenticator and try again."
    )


def verify_recovery_code(
    session: Session, *, user: User, challenge_id: str, code: str
) -> bool:
    """Consume a single-use recovery code for this challenge (AC4).

    Returns True when a code matched and was consumed; raises the same
    challenge errors otherwise. Attempt counting matches code attempts.
    """
    challenge = session.get(MfaLoginChallenge, _uuid_or_none(challenge_id))
    if challenge is None or challenge.user_id != user.id or challenge.consumed:
        raise InvalidMfaCodeError("That sign-in challenge is invalid. Start again.")

    expires_at = challenge.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if expires_at < _utcnow():
        raise InvalidMfaCodeError("That sign-in challenge has expired. Start again.")

    if challenge.failed_attempts >= settings.mfa_max_attempts:
        raise ChallengeLockedError(
            "Too many incorrect attempts. Sign in again to get a fresh challenge."
        )

    normalized = code.strip().upper().replace(" ", "")
    code_hash = hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    recovery = session.exec(
        select(MfaRecoveryCode).where(
            MfaRecoveryCode.user_id == user.id,
            MfaRecoveryCode.code_hash == code_hash,
            MfaRecoveryCode.used_at.is_(None),  # type: ignore[attr-defined]
        )
    ).first()

    if recovery is not None:
        recovery.used_at = _utcnow()
        challenge.consumed = True
        session.add(recovery)
        session.add(challenge)
        session.commit()
        return True

    challenge.failed_attempts += 1
    session.add(challenge)
    session.commit()

    if challenge.failed_attempts >= settings.mfa_max_attempts:
        raise ChallengeLockedError(
            "Too many incorrect attempts. Sign in again to get a fresh challenge."
        )
    raise InvalidMfaCodeError(
        "That recovery code didn't match. Check it and try again."
    )


def _uuid_or_none(value: str):
    from uuid import UUID

    try:
        return UUID(value)
    except (TypeError, ValueError):
        return None
