"""Issue a short-lived JWT for the seeded local demo learner.

Local development only. Never expose this as an API endpoint.
"""

import argparse

from sqlmodel import Session

from app.core.security import create_access_token
from app.db.session import engine
from app.models import User
from scripts.seed_demo_exams import (
    DEMO_USER_ID,
    require_safe_local_database,
)


def issue_demo_token() -> str:
    """Issue a JWT only for an existing local demo learner."""
    require_safe_local_database()

    with Session(engine) as session:
        learner = session.get(User, DEMO_USER_ID)

        if learner is None:
            raise RuntimeError("Demo learner not found. Run seed_demo_exams first.")

    return create_access_token(str(DEMO_USER_ID))


def main() -> None:
    parser = argparse.ArgumentParser(description="Issue a local development JWT")
    parser.add_argument(
        "--confirm-local",
        action="store_true",
        help="Confirm the database is disposable and local",
    )
    args = parser.parse_args()

    if not args.confirm_local:
        parser.error("Use --confirm-local for local development")

    token = issue_demo_token()

    print("Local demo bearer token:")
    print(token)


if __name__ == "__main__":
    main()
