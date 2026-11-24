"""Create six verified local administrator accounts without enrolling in MFA.

From backend/:
    python -m scripts.seed_local_admins --confirm-local

Disposable local development databases only. Existing accounts are not modified.
"""

from __future__ import annotations

import argparse
from getpass import getpass
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import func
from sqlmodel import Session, select

from app.core.security import hash_password
from app.db.session import engine
from app.models import User
from app.services.registration_service import validate_password
from scripts.seed_demo_exams import require_safe_local_database

ADMIN_EMAILS = tuple(f"admin{number}@jobhackers.test" for number in range(1, 7))


def seed_local_admins(password: str) -> list[tuple[str, str]]:
    """Insert missing seed accounts atomically and preserve existing accounts."""
    require_safe_local_database()
    validate_password(password)
    results = []

    with Session(engine) as session, session.begin():
        for number, email in enumerate(ADMIN_EMAILS, start=1):
            user_id = uuid5(NAMESPACE_URL, f"job-hackers/local-admins/v1/{email}")
            matching = session.exec(
                select(User).where(func.lower(User.email) == email)
            ).all()
            existing = session.get(User, user_id)

            if matching or existing is not None:
                if (
                    existing is None
                    or existing.email != email
                    or len(matching) != 1
                    or matching[0].id != user_id
                    or existing.role != "administrator"
                    or not existing.is_verified
                    or not existing.hashed_password
                ):
                    raise RuntimeError(
                        f"Account conflict for {email}; no accounts were changed."
                    )

                if existing.mfa_enrolled_at is not None:
                    status = "existing; MFA enrolled, unchanged"
                elif existing.totp_secret_encrypted is not None:
                    status = "existing; MFA setup started, unchanged"
                else:
                    status = "existing; MFA not enrolled, unchanged"
                results.append((email, status))
                continue

            session.add(
                User(
                    id=user_id,
                    email=email,
                    full_name=f"Local Administrator {number}",
                    hashed_password=hash_password(password),
                    role="administrator",
                    is_verified=True,
                    totp_secret_encrypted=None,
                    mfa_enrolled_at=None,
                )
            )
            results.append((email, "created; MFA not enrolled"))

    return results


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--confirm-local",
        action="store_true",
        help="Confirm the configured database is disposable and local.",
    )
    args = parser.parse_args()
    if not args.confirm_local:
        parser.error("Use --confirm-local only for local development.")

    try:
        require_safe_local_database()
        print("Choose a password for the new local demo administrators.")
        password = getpass("Local admin password: ")
        validate_password(password)
        if password != getpass("Confirm password: "):
            parser.error("Passwords do not match.")
        results = seed_local_admins(password)
    except (RuntimeError, ValueError) as exc:
        parser.exit(1, f"Seed refused: {exc}\n")

    print("\nLocal administrator accounts:")
    for email, status in results:
        print(f"  {email}: {status}")
    print("\nNew accounts use the password you entered.")
    print("Existing accounts retain their passwords and MFA settings.")
    print("The normal mandatory administrator MFA enrollment policy still applies.")


if __name__ == "__main__":
    main()
