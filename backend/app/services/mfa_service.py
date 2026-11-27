"""TOTP multi-factor authentication (JHEP-109).

Design guarantees:
- Unenrolled administrators receive enrollment-only sessions; unrestricted
  administrative access requires enrollment and a new two-factor sign-in.
- Administrators are required by policy to enroll; Contributors may enroll.
  Once confirmed, MFA is required at sign-in regardless of subsequent role
  changes. Learners cannot start a new enrollment.
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
from base64 import b32decode
from datetime import UTC, datetime, timedelta
from typing import NoReturn
from uuid import UUID

import pyotp
from cryptography.fernet import Fernet, InvalidToken
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


def has_usable_enrollment(user: User) -> bool:
    """Check confirmed MFA can be decrypted without revealing any secret."""
    if user.mfa_enrolled_at is None or not user.totp_secret_encrypted:
        return False
    try:
        secret = _decrypt_secret(user.totp_secret_encrypted)
        padded = secret + "=" * ((-len(secret)) % 8)
        return bool(b32decode(padded, casefold=True))
    except (MfaNotConfiguredError, InvalidToken, ValueError, TypeError):
        return False


def administrator_requires_enrollment(user: User) -> bool:
    """Mandatory policy; no deployment-level bypass for administrator access."""
    return user.role in MFA_MANDATORY_ROLES and user.mfa_enrolled_at is None


def mfa_required_for(user: User) -> bool:
    """Confirmed MFA remains required even after a role change."""
    return user.mfa_enrolled_at is not None


def mfa_available_for(user: User) -> bool:
    """Whether the account MAY enroll (the policy's optional set)."""
    return user.role in MFA_MANDATORY_ROLES or user.role in MFA_OPTIONAL_ROLES


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


def _locked_user(session: Session, user_id: UUID) -> User | None:
    return session.exec(
        select(User)
        .where(User.id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).first()


def _enrollment_actor(session: Session, actor: User) -> User:
    # Capture the cutoff before refreshing the same identity-map object.
    cutoff = actor.sessions_invalid_before
    current = _locked_user(session, actor.id)
    if current is None or not current.is_verified or not mfa_available_for(current):
        raise EnrollmentNotAllowedError("MFA enrollment is not available for this role")
    latest_cutoff = current.sessions_invalid_before
    if (_as_utc(latest_cutoff) if latest_cutoff is not None else None) != (
        _as_utc(cutoff) if cutoff is not None else None
    ):
        raise EnrollmentNotAllowedError("Your session changed. Sign in again.")
    if current.mfa_enrolled_at is not None:
        raise MfaAlreadyEnrolledError("MFA is already enabled on this account")
    return current


def begin_enrollment(session: Session, *, actor: User) -> dict:
    """Generate (or re-generate) an unconfirmed secret + provisioning
    data. Re-generation invalidates any prior unconfirmed secret."""
    actor = _enrollment_actor(session, actor)
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
    actor = _enrollment_actor(session, actor)
    if not actor.totp_secret_encrypted:
        raise MfaNotEnrolledError("Start enrollment first (request the setup data)")

    secret = _decrypt_secret(actor.totp_secret_encrypted)
    if not _verify_code(secret, code):
        raise InvalidMfaCodeError(
            "That code didn't match. Check your authenticator and try again."
        )

    enrolled_at = _utcnow()
    actor.mfa_enrolled_at = enrolled_at
    actor.sessions_invalid_before = max(
        enrolled_at,
        _as_utc(actor.sessions_invalid_before)
        if actor.sessions_invalid_before is not None
        else enrolled_at,
    )
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


def _challenge_for_verification(
    session: Session, *, user: User, challenge_id: str
) -> tuple[User, MfaLoginChallenge, datetime]:
    """Serialize factor use for one account and one outstanding challenge."""
    # Account first, then challenge/recovery rows. Enrollment and password
    # reset use the same account lock. Refresh objects after acquiring locks.
    current = _locked_user(session, user.id)
    if current is None or not current.is_verified:
        raise InvalidMfaCodeError("That sign-in challenge is invalid. Start again.")
    parsed = _uuid_or_none(challenge_id)
    if parsed is None:
        raise InvalidMfaCodeError("That sign-in challenge is invalid. Start again.")
    challenge = session.exec(
        select(MfaLoginChallenge)
        .where(MfaLoginChallenge.id == parsed)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).first()
    if challenge is None or challenge.user_id != current.id or challenge.consumed:
        raise InvalidMfaCodeError("That sign-in challenge is invalid. Start again.")
    if _as_utc(challenge.expires_at) < _utcnow():
        raise InvalidMfaCodeError("That sign-in challenge has expired. Start again.")
    authenticated_at = _as_utc(challenge.created_at)
    if current.sessions_invalid_before is not None and authenticated_at < _as_utc(
        current.sessions_invalid_before
    ):
        raise InvalidMfaCodeError("Your session changed. Sign in again.")
    if challenge.failed_attempts >= settings.mfa_max_attempts:
        raise ChallengeLockedError(
            "Too many incorrect attempts. Sign in again to get a fresh challenge."
        )
    if not current.totp_secret_encrypted or current.mfa_enrolled_at is None:
        raise MfaNotEnrolledError("This account has no confirmed MFA enrollment")
    return current, challenge, authenticated_at


def _failed_challenge(
    session: Session, challenge: MfaLoginChallenge, *, recovery: bool = False
) -> NoReturn:
    challenge.failed_attempts += 1
    locked = challenge.failed_attempts >= settings.mfa_max_attempts
    session.add(challenge)
    session.commit()
    if locked:
        raise ChallengeLockedError(
            "Too many incorrect attempts. Sign in again to get a fresh challenge."
        )
    message = (
        "That recovery code didn't match. Check it and try again."
        if recovery
        else "That code didn't match. Check your authenticator and try again."
    )
    raise InvalidMfaCodeError(message)


def verify_challenge(
    session: Session, *, user: User, challenge_id: str, code: str
) -> datetime:
    """Consume a valid TOTP challenge and return its original auth time."""
    current, challenge, authenticated_at = _challenge_for_verification(
        session, user=user, challenge_id=challenge_id
    )
    assert current.totp_secret_encrypted is not None
    secret = _decrypt_secret(current.totp_secret_encrypted)
    if not _verify_code(secret, code.strip()):
        _failed_challenge(session, challenge)
    challenge.consumed = True
    session.add(challenge)
    session.commit()
    return authenticated_at


def verify_recovery_code(
    session: Session, *, user: User, challenge_id: str, code: str
) -> datetime:
    """Consume a single-use recovery code and return the original auth time."""
    current, challenge, authenticated_at = _challenge_for_verification(
        session, user=user, challenge_id=challenge_id
    )
    normalized = code.strip().upper().replace(" ", "")
    code_hash = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    recovery = session.exec(
        select(MfaRecoveryCode)
        .where(
            MfaRecoveryCode.user_id == current.id,
            MfaRecoveryCode.code_hash == code_hash,
            MfaRecoveryCode.used_at.is_(None),  # type: ignore[attr-defined]
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    ).first()
    if recovery is None:
        _failed_challenge(session, challenge, recovery=True)
    recovery.used_at = _utcnow()
    challenge.consumed = True
    session.add(recovery)
    session.add(challenge)
    session.commit()
    return authenticated_at


def _uuid_or_none(value: str):
    try:
        return UUID(value)
    except (TypeError, ValueError):
        return None
