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


class NotAContributorError(Exception):
    """Grading permissions apply only to Contributor accounts."""


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


def _audit_grading_permission(
    session: Session,
    *,
    actor: User,
    target_id,
    permission: str,
    previous_value: bool,
    new_value: bool,
) -> None:
    from app.models import PermissionChangeAudit

    session.add(
        PermissionChangeAudit(
            actor_id=actor.id,
            target_id=target_id,
            permission=permission,
            action="granted" if new_value else "revoked",
            previous_value=previous_value,
            new_value=new_value,
        )
    )


def update_grading_permissions(
    session: Session,
    *,
    actor: User,
    target_id,
    grade_short_answers: bool | None,
    grade_essays: bool | None,
) -> tuple[User, list]:
    """JHEP-192 AC1/AC5: save a Contributor's written-response grading
    permissions (two independent flags). All refusals raise before any
    mutation; the audit rows commit atomically with the change."""
    target = session.get(User, target_id)

    if target is None:
        raise UserNotFoundError(f"User {target_id} does not exist")

    # AC1: only Contributor accounts carry grading permissions —
    # Administrators grade everything inherently (AC3) and Learners
    # cannot grade, so neither is a valid target.
    if target.role != UserRole.CONTRIBUTOR.value:
        raise NotAContributorError(
            "Grading permissions apply only to Contributor accounts"
        )

    audits = []

    if (
        grade_short_answers is not None
        and target.grade_short_answers != grade_short_answers
    ):
        _audit_grading_permission(
            session,
            actor=actor,
            target_id=target.id,
            permission="grade_short_answers",
            previous_value=target.grade_short_answers,
            new_value=grade_short_answers,
        )
        audits.append(
            {
                "permission": "grade_short_answers",
                "action": "granted" if grade_short_answers else "revoked",
                "previous_value": target.grade_short_answers,
                "new_value": grade_short_answers,
            }
        )
        target.grade_short_answers = grade_short_answers

    if grade_essays is not None and target.grade_essays != grade_essays:
        _audit_grading_permission(
            session,
            actor=actor,
            target_id=target.id,
            permission="grade_essays",
            previous_value=target.grade_essays,
            new_value=grade_essays,
        )
        audits.append(
            {
                "permission": "grade_essays",
                "action": "granted" if grade_essays else "revoked",
                "previous_value": target.grade_essays,
                "new_value": grade_essays,
            }
        )
        target.grade_essays = grade_essays

    if not audits:
        # no-op save: a safe success without audit rows (mirrors change_role)
        return target, []

    session.add(target)
    session.commit()
    session.refresh(target)

    return target, audits


def can_grade_response_type(actor: User, response_type: str) -> bool:
    """JHEP-122's enforcement hook (AC2/AC3).

    Administrators grade every response type inherently; Contributors
    grade only the types their permissions allow; other roles never.
    Call this from every manual-grading route — the flags live on the
    User row, so a revocation takes effect on the next request (AC4).
    """
    if actor.role == UserRole.ADMINISTRATOR.value:
        return True

    if actor.role != UserRole.CONTRIBUTOR.value:
        return False

    if response_type == "essay":
        return actor.grade_essays

    if response_type == "short_answer":
        return actor.grade_short_answers

    return False


def audit_record(audit: RoleChangeAudit) -> dict:
    """The before/after metadata the API response carries (AC4)."""
    return {
        "action": audit.action,
        "role_before": audit.role_before,
        "role_after": audit.role_after,
        "changed_at": (audit.created_at or datetime.now(UTC)).isoformat(),
    }
