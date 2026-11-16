"""Attach hosted image metadata to a local demo practice question.

Run from backend/:

    python -m scripts.seed_demo_question_images --confirm-local

The actual image bytes live in Cloudflare R2. PostgreSQL stores only the
object-storage key, accessible description, media type, and display position.

This script is deterministic and safe to rerun. It refuses to operate against
a non-local or production-looking database.
"""

from __future__ import annotations

import argparse

from sqlmodel import Session

from app.db.session import engine
from app.models import QuestionImage, QuestionVersion
from scripts.seed_demo_exams import (
    demo_uuid,
    ensure_row,
    require_safe_local_database,
)

# Existing seeded question:
#
# Professional Scrum Master I — Demo
# Question 13: "What is backlog refinement?"
#
# The image is supplementary context for this question.
QUESTION_VERSION_ID = demo_uuid("psm1/version/13")

# Deterministic ID makes the script idempotent.
QUESTION_IMAGE_ID = demo_uuid("psm1/image/13/1")

# This is the R2 object key, not the complete public URL.
STORAGE_KEY = "questions/demo/agile.png"

# Confirm this accurately describes the actual image before committing.
ALT_TEXT = (
    "Agile workflow diagram showing work moving through an iterative "
    "planning and delivery process."
)

MEDIA_TYPE = "image/png"
POSITION = 1


def seed() -> bool:
    """Insert the version-pinned image reference once."""

    require_safe_local_database()

    with Session(engine) as session, session.begin():
        version = session.get(
            QuestionVersion,
            QUESTION_VERSION_ID,
        )

        if version is None:
            raise RuntimeError(
                "Target demo question version was not found. "
                "Run scripts.seed_demo_exams first."
            )

        return bool(
            ensure_row(
                session,
                QuestionImage(
                    id=QUESTION_IMAGE_ID,
                    question_version_id=QUESTION_VERSION_ID,
                    storage_key=STORAGE_KEY,
                    alt_text=ALT_TEXT,
                    media_type=MEDIA_TYPE,
                    position=POSITION,
                ),
                (
                    "question_version_id",
                    "storage_key",
                    "alt_text",
                    "media_type",
                    "position",
                ),
            )
        )


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
    )

    parser.add_argument(
        "--confirm-local",
        action="store_true",
        help=(
            "Required acknowledgment that the target is a disposable "
            "local development database"
        ),
    )

    args = parser.parse_args()

    if not args.confirm_local:
        parser.error(
            "Only disposable local databases are allowed; "
            "pass --confirm-local"
        )

    inserted = seed()

    if inserted:
        print("Hosted question image reference inserted.")
    else:
        print("Hosted question image reference already exists.")

    print(f"Question version: {QUESTION_VERSION_ID}")
    print(f"Storage key: {STORAGE_KEY}")
    print(f"Media type: {MEDIA_TYPE}")
    print(f"Position: {POSITION}")
    print(f"Alt text: {ALT_TEXT}")


if __name__ == "__main__":
    main()