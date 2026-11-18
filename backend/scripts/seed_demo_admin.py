"""Create or refresh the local JHEP-159 demo administrator.

Run from backend/:

    python -m scripts.seed_demo_admin --confirm-local

Local development only. Never run against production.
"""

from __future__ import annotations

import argparse
from uuid import UUID

from sqlmodel import Session, select

from app.core.security import hash_password
from app.db.session import engine
from app.models import User
from scripts.seed_demo_exams import (
    demo_uuid,
    require_safe_local_database,
)

DEMO_ADMIN_ID: UUID = demo_uuid("administrator")
DEMO_ADMIN_EMAIL = "jhep159-demo-admin@example.test"
DEMO_ADMIN_PASSWORD = "DemoAdm1n!"


def seed_demo_admin() -> User:
    """Create a deterministic verified local administrator account."""
    require_safe_local_database()

    with Session(engine) as session:
        existing_by_email = session.exec(
            select(User).where(User.email == DEMO_ADMIN_EMAIL)
        ).first()

        if existing_by_email is not None and existing_by_email.id != DEMO_ADMIN_ID:
            raise RuntimeError(
                "Demo administrator email is already used by another account"
            )

        administrator = session.get(
            User,
            DEMO_ADMIN_ID,
        )

        if administrator is None:
            administrator = User(
                id=DEMO_ADMIN_ID,
                email=DEMO_ADMIN_EMAIL,
                full_name="Demo Administrator",
                hashed_password=hash_password(DEMO_ADMIN_PASSWORD),
                role="administrator",
                is_verified=True,
            )
        else:
            if administrator.email != DEMO_ADMIN_EMAIL:
                raise RuntimeError("Demo administrator UUID belongs to another account")

            administrator.full_name = "Demo Administrator"

            administrator.hashed_password = hash_password(DEMO_ADMIN_PASSWORD)

            administrator.role = "administrator"
            administrator.is_verified = True

        session.add(administrator)
        session.commit()
        session.refresh(administrator)

        return administrator


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
    )

    parser.add_argument(
        "--confirm-local",
        action="store_true",
        help=("Confirm the database is disposable and local"),
    )

    args = parser.parse_args()

    if not args.confirm_local:
        parser.error("Use --confirm-local only for local development")

    administrator = seed_demo_admin()

    print("Demo administrator ready:")
    print(f"  UUID: {administrator.id}")
    print(f"  Email: {DEMO_ADMIN_EMAIL}")
    print(f"  Password: {DEMO_ADMIN_PASSWORD}")
    print(f"  Role: {administrator.role}")


if __name__ == "__main__":
    main()
