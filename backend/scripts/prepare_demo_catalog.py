"""Prepare published categories for the local JHEP demo."""

import argparse

from sqlmodel import Session

from app.db.session import engine
from app.models import Category, Certification
from scripts.seed_demo_exams import (
    CERTIFICATIONS,
    demo_uuid,
    require_safe_local_database,
)


def prepare_demo_catalog() -> int:
    """Publish seeded categories and enable immediate feedback."""
    require_safe_local_database()
    changed = 0

    with Session(engine) as session, session.begin():
        for demo in CERTIFICATIONS:
            cert_id = demo_uuid(f"{demo.slug}/certification")
            category_id = demo_uuid(f"{demo.slug}/category")

            certification = session.get(Certification, cert_id)
            category = session.get(Category, category_id)

            if certification is None or category is None:
                raise RuntimeError("Demo catalog is missing; seed the database first")

            if category.certification_id != certification.id:
                raise RuntimeError("Demo category belongs to a different certification")

            if not category.is_published:
                category.is_published = True
                changed += 1

            if certification.feedback_mode != "immediate":
                certification.feedback_mode = "immediate"
                changed += 1

            if certification.passing_threshold_pct is None:
                certification.passing_threshold_pct = 65
                changed += 1

    return changed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--confirm-local", action="store_true")
    args = parser.parse_args()

    if not args.confirm_local:
        parser.error("Only disposable local databases are allowed")

    changed = prepare_demo_catalog()
    print(f"Demo catalog ready ({changed} settings changed).")


if __name__ == "__main__":
    main()
