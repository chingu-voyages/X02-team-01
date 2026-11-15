"""Administrator-managed user accounts and role changes (JHEP-125).

AC1: an Administrator locates an existing account and changes its role
Learner<->Contributor; identity, history and profile are untouched.

AC2: only an authorized Administrator may change the role (the router's
`require_administrator` guard plus the service's own rules); because
every admin request resolves the actor's role from the DATABASE row, a
revocation takes effect on the very next request of any stale session —
no token re-issue, no session store.

AC3: role changes never touch questions, versions, statuses, feedback
or history — content stays exactly where its owner left it.

AC4: denied/invalid changes raise before any mutation, and every
successful change writes a `role_change_audit` row (actor, target,
action, before/after, timestamp) — the JHEP-111 publishing contract
arrives later and non-blocking.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlmodel import Session, func, or_, select

from app.core.roles import UserRole
from app.models import RoleChangeAudit, User

MANAGEABLE_ROLES = (UserRole.LEARNER, UserRole.CONTRIBUTOR)


class UserNotFoundError(Exception):
    """The target account does not exist."""


class AdministratorRoleChangeError(Exception):
    """This screen cannot change an Administrator's role."""


class SelfRoleChangeError(Exception):
    """An Administrator cannot change their own role."""


def list_users(
    session: Session,
    *,
    actor: User,
    q: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[User], int]:
    """Locate accounts for the Users & Access screen (email/name search)."""
    statement = select(User).order_by(User.email)
    count_statement = select(func.count(User.id))

    if q:
        pattern = f"%{q.strip()}%"
        search = or_(
            User.email.ilike(pattern),
            User.full_name.ilike(pattern),
        )
        statement = statement.where(search)
        count_statement = count_statement.where(search)

    statement = statement.offset(offset).limit(limit)
    users = list(session.exec(statement).all())
    total = session.exec(count_statement).one()
    return users, total


def change_role(
    session: Session,
    *,
    actor: User,
    target_id: UUID,
    new_role: str,
) -> tuple[User, RoleChangeAudit]:
    """Move one account between Learner and Contributor.

    All refusals raise BEFORE any mutation (AC4). The audit row commits
    atomically with the role change.
    """
    if new_role not in [role.value for role in MANAGEABLE_ROLES]:
        raise ValueError(f"Role {new_role!r} is not manageable on this screen")

    target = session.get(User, target_id)
    if target is None:
        raise UserNotFoundError(f"User {target_id} does not exist")

    if actor.id == target.id:
        raise SelfRoleChangeError("An Administrator cannot change their own role")

    if target.role == UserRole.ADMINISTRATOR.value:
        raise AdministratorRoleChangeError(
            "This screen cannot change an Administrator's role — "
            "Administrator provisioning is separately governed"
        )

    if target.role == new_role:
        # No-op: treat as a safe success without an audit row or write.
        audit = RoleChangeAudit(
            actor_id=actor.id,
            target_id=target.id,
            action="promoted" if new_role == UserRole.CONTRIBUTOR.value else "revoked",
            role_before=target.role,
            role_after=target.role,
            note="no-op: role already set",
        )
        return target, audit

    action = "promoted" if new_role == UserRole.CONTRIBUTOR.value else "revoked"

    audit = RoleChangeAudit(
        actor_id=actor.id,
        target_id=target.id,
        action=action,
        role_before=target.role,
        role_after=new_role,
    )

    target.role = new_role
    session.add(target)
    session.add(audit)
    session.commit()
    session.refresh(target)
    session.refresh(audit)

    return target, audit


def audit_record(audit: RoleChangeAudit) -> dict:
    """The before/after metadata the API response carries (AC4)."""
    return {
        "action": audit.action,
        "role_before": audit.role_before,
        "role_after": audit.role_after,
        "changed_at": (audit.created_at or datetime.now(UTC)).isoformat(),
    }
