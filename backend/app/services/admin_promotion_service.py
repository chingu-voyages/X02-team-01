"""Administrator promotion is intentionally separate from normal role changes.

The existing password + MFA sign-in provides the recent-authentication proof.
No passwords, authenticator codes or elevation tokens are accepted here.
All writes (including the audit row) share one transaction. The locked actor
and target are rechecked after locking, so a concurrent role change or reset
cannot silently invalidate the authorization used to grant access.
"""

import math
from datetime import UTC, datetime
from uuid import UUID

import jwt
from sqlmodel import Session, select

from app.core.config import settings
from app.core.roles import UserRole
from app.models import RoleChangeAudit, User
from app.schemas.admin_promotion import (
    AdministratorPromotionEligibility,
    AdministratorPromotionIn,
    AdministratorPromotionOut,
    PromotionIssue,
)
from app.schemas.admin_user import AdminUserOut
from app.services import mfa_service

AUTHENTICATION_MAX_AGE_SECONDS = 300


class PromotionError(Exception):
    def __init__(self, status_code: int, code: str, message: str) -> None:
        self.status_code = status_code
        self.code = code
        super().__init__(message)


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _timestamp(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        return float(value) if math.isfinite(value) else None
    except (OverflowError, ValueError):
        return None


def _unauthorized() -> PromotionError:
    return PromotionError(
        401, "ADMIN_PROMOTION_SESSION_INVALID", "Sign in again before continuing."
    )


def _not_found() -> PromotionError:
    return PromotionError(404, "USER_NOT_FOUND", "The selected account was not found.")


def _actor_has_recent_authentication(actor: User, token: str, now: datetime) -> bool:
    """Check signed claims and current actor state, including the revocation cutoff."""
    if actor.role != UserRole.ADMINISTRATOR.value:
        raise PromotionError(
            403, "ADMIN_PROMOTION_FORBIDDEN", "Administrator access is required."
        )
    if (
        not actor.is_verified
        or not actor.hashed_password
        or actor.mfa_enrolled_at is None
    ):
        raise PromotionError(
            403,
            "ADMIN_PROMOTION_ACTOR_NOT_READY",
            "Your administrator account must be verified and have confirmed MFA.",
        )
    if not mfa_service.mfa_configured() or not mfa_service.has_usable_enrollment(actor):
        raise PromotionError(
            503,
            "ADMIN_PROMOTION_MFA_UNAVAILABLE",
            "Administrator MFA is unavailable. Contact the platform administrator.",
        )

    try:
        claims = jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
            options={"require": ["sub", "iat", "exp"]},
        )
    except (jwt.InvalidTokenError, OverflowError, ValueError, TypeError) as exc:
        raise _unauthorized() from exc
    if claims.get("sub") != str(actor.id) or claims.get("mfa") is not None:
        raise _unauthorized()
    issued = _timestamp(claims.get("iat"))
    verified = _timestamp(claims.get("mfa_verified_at"))
    current = now.timestamp()
    if issued is None or issued > current:
        raise _unauthorized()
    if (
        actor.sessions_invalid_before is not None
        and issued < _as_utc(actor.sessions_invalid_before).timestamp()
    ):
        raise _unauthorized()

    # Require a session authenticated *as* administrator. A prior Contributor
    # token must not acquire this authority just because the DB role changed.
    if claims.get("role") != UserRole.ADMINISTRATOR.value:
        return False
    if verified is None or not issued <= verified <= current:
        return False
    if verified < _as_utc(actor.mfa_enrolled_at).timestamp():
        return False
    return (
        current - issued <= AUTHENTICATION_MAX_AGE_SECONDS
        and current - verified <= AUTHENTICATION_MAX_AGE_SECONDS
    )


def _target_issues(actor: User, target: User) -> list[PromotionIssue]:
    if actor.id == target.id:
        return [
            PromotionIssue(
                code="ADMIN_PROMOTION_SELF",
                message="You cannot promote your own account.",
            )
        ]
    if target.role != UserRole.CONTRIBUTOR.value:
        return [
            PromotionIssue(
                code="ADMIN_PROMOTION_CONTRIBUTOR_REQUIRED",
                message="Only an existing Contributor can be promoted to Administrator.",
            )
        ]
    issues: list[PromotionIssue] = []
    if not target.is_verified:
        issues.append(
            PromotionIssue(
                code="ADMIN_PROMOTION_EMAIL_UNVERIFIED",
                message="The account owner must verify their email address first.",
            )
        )
    if not target.hashed_password:
        issues.append(
            PromotionIssue(
                code="ADMIN_PROMOTION_PASSWORD_REQUIRED",
                message="The account must have its own sign-in password.",
            )
        )
    if target.mfa_enrolled_at is None:
        issues.append(
            PromotionIssue(
                code="ADMIN_PROMOTION_MFA_REQUIRED",
                message="The Contributor must complete two-factor enrollment first.",
            )
        )
    elif not mfa_service.has_usable_enrollment(target):
        issues.append(
            PromotionIssue(
                code="ADMIN_PROMOTION_TARGET_MFA_UNAVAILABLE",
                message="The account's confirmed MFA enrollment is unavailable. Resolve it before promotion.",
            )
        )
    return issues


def get_administrator_promotion_eligibility(
    session: Session, *, actor: User, target_id: UUID, token: str
) -> AdministratorPromotionEligibility:
    """Read-only review of eligibility. A preview is never an authorization."""
    recent = _actor_has_recent_authentication(actor, token, datetime.now(UTC))
    target = session.get(User, target_id, populate_existing=True)
    if target is None:
        raise _not_found()
    issues = _target_issues(actor, target)
    return AdministratorPromotionEligibility(
        target=AdminUserOut.model_validate(target, from_attributes=True),
        mfa_enrolled=target.mfa_enrolled_at is not None,
        eligible=not issues,
        issues=issues,
        recent_authentication=recent,
        authentication_max_age_seconds=AUTHENTICATION_MAX_AGE_SECONDS,
    )


def promote_administrator(
    session: Session,
    *,
    actor_id: UUID,
    target_id: UUID,
    token: str,
    payload: AdministratorPromotionIn,
) -> AdministratorPromotionOut:
    """Grant Administrator access only after fresh authorization and confirmation."""
    try:
        # Lock in consistent order. Refresh identity-map records to avoid stale
        # authorization after waiting for a concurrent role or password change.
        accounts = session.exec(
            select(User)
            .where(User.id.in_([actor_id, target_id]))
            .order_by(User.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).all()
        by_id = {account.id: account for account in accounts}
        actor = by_id.get(actor_id)
        if actor is None:
            raise _unauthorized()
        now = datetime.now(UTC)
        if not _actor_has_recent_authentication(actor, token, now):
            raise PromotionError(
                403,
                "ADMIN_PROMOTION_REAUTH_REQUIRED",
                "Sign in again with your password and two-factor verification before promoting this account.",
            )
        target = by_id.get(target_id)
        if target is None:
            raise _not_found()
        issues = _target_issues(actor, target)
        if issues:
            raise PromotionError(409, issues[0].code, issues[0].message)
        if not payload.confirm:
            raise PromotionError(
                422,
                "ADMIN_PROMOTION_CONFIRMATION_REQUIRED",
                "Explicit confirmation is required.",
            )
        if payload.confirmation_email.casefold() != target.email.casefold():
            raise PromotionError(
                409,
                "ADMIN_PROMOTION_EMAIL_MISMATCH",
                "Enter the selected account's email address exactly.",
            )

        # The final authorization check also catches a freshness window that
        # expired while the request was waiting or validating the target.
        changed_at = datetime.now(UTC)
        if not _actor_has_recent_authentication(actor, token, changed_at):
            raise PromotionError(
                403,
                "ADMIN_PROMOTION_REAUTH_REQUIRED",
                "Sign in again before promoting this account.",
            )
        target.role = UserRole.ADMINISTRATOR.value
        cutoff = target.sessions_invalid_before
        target.sessions_invalid_before = (
            max(changed_at, _as_utc(cutoff)) if cutoff is not None else changed_at
        )
        audit = RoleChangeAudit(
            actor_id=actor.id,
            target_id=target.id,
            action="promoted",
            role_before=UserRole.CONTRIBUTOR.value,
            role_after=UserRole.ADMINISTRATOR.value,
            note=payload.reason,
            created_at=changed_at,
        )
        session.add(target)
        session.add(audit)
        session.flush()
        result = AdministratorPromotionOut(
            user=AdminUserOut.model_validate(target, from_attributes=True),
            audit_id=audit.id,
            changed_at=changed_at,
        )
        session.commit()
        return result
    except Exception:
        session.rollback()
        raise
