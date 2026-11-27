"""Create an isolated, unenrolled administrator for LOCAL browser tests only."""

import argparse
import json
import secrets
from uuid import uuid4

from sqlmodel import Session

from app.core.security import hash_password
from app.db.session import engine
from app.models import User
from app.services.mfa_service import mfa_configured
from scripts.seed_demo_exams import require_safe_local_database


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm-local", action="store_true")
    if not parser.parse_args().confirm_local:
        parser.error("Confirm a disposable local database with --confirm-local")
    require_safe_local_database()
    if not mfa_configured():
        raise RuntimeError("Configure a disposable local MFA_ENCRYPTION_KEY first.")
    suffix = uuid4().hex[:16]
    email = f"jhep207-enrollment-{suffix}@example.test"
    password = f"JhepE2e1!{secrets.token_urlsafe(20)}"
    with Session(engine) as session:
        user = User(
            email=email,
            full_name="Enrollment E2E",
            role="administrator",
            is_verified=True,
            hashed_password=hash_password(password),
        )
        session.add(user)
        session.commit()
    # Captured by Playwright; never use this script for real administrators.
    print(json.dumps({"email": email, "password": password}))


if __name__ == "__main__":
    main()
