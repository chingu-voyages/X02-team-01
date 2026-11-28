"""Prepare isolated, local-only JHEP-105 browser test fixtures.

Run from backend/ with --confirm-local. Each run creates a fresh catalog,
question bank, published exam, fixture author and verified learner.
No existing user, question, attempt, or credential is changed or deleted.
The JSON output is consumed by Playwright, not a production login utility.
"""

from __future__ import annotations

import argparse
import json
import secrets
from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlmodel import Session

from app.core.config import settings
from app.core.security import hash_password
from app.db.session import engine
from app.models import (
    AnswerOption,
    Category,
    Certification,
    PracticeExam,
    Question,
    QuestionVersion,
    User,
)
from scripts.seed_demo_exams import demo_uuid, ensure_row, require_safe_local_database

COUNTS = {"immediate": 3, "deferred": 40}


def seed_navigation_fixture(mode: str) -> dict[str, str | int]:
    require_safe_local_database()
    count = COUNTS[mode]
    if count > settings.max_exam_questions:
        raise RuntimeError(
            f"This fixture requires MAX_EXAM_QUESTIONS >= {count}. "
            "Use the disposable local test configuration."
        )

    run_id = uuid4().hex[:12]

    def fixture_id(name: str) -> UUID:
        return demo_uuid(f"jhep-105/navigation-e2e/v2/{run_id}/{name}")

    author_id = fixture_id("fixture-author")
    certification_id = fixture_id(f"{mode}/certification")
    category_id = fixture_id(f"{mode}/category")
    practice_exam_id = fixture_id(f"{mode}/practice-exam")
    learner_id = uuid4()
    email = f"jhep105-e2e-{learner_id.hex}@example.test"
    password = f"NavTest1!{secrets.token_urlsafe(18)}"

    with Session(engine) as session, session.begin():
        # A dedicated non-login fixture author avoids touching demo accounts.
        ensure_row(
            session,
            User(
                id=author_id,
                email=f"jhep105-fixture-{run_id}@example.test",
                full_name="JHEP-105 Fixture Author",
                role="learner",
                is_verified=False,
            ),
            ("email", "role", "is_verified", "hashed_password"),
        )
        ensure_row(
            session,
            Certification(
                id=certification_id,
                code=f"JHEP105-E2E-{mode.upper()}-{run_id.upper()}",
                name=f"JHEP-105 E2E ({mode} feedback) {run_id}",
                feedback_mode=mode,
                passing_threshold_pct=65,
                is_published=True,
            ),
            ("code", "name", "feedback_mode", "passing_threshold_pct", "is_published"),
        )
        ensure_row(
            session,
            Category(
                id=category_id,
                certification_id=certification_id,
                name="Navigation test fixtures",
                is_published=True,
            ),
            ("certification_id", "name", "is_published"),
        )
        for number in range(1, count + 1):
            question_id = fixture_id(f"{mode}/question/{number}")
            version_id = fixture_id(f"{mode}/version/{number}")
            ensure_row(
                session,
                Question(
                    id=question_id,
                    certification_id=certification_id,
                    category_id=category_id,
                    difficulty="easy",
                    created_by_id=author_id,
                ),
                ("certification_id", "category_id", "difficulty", "created_by_id"),
            )
            ensure_row(
                session,
                QuestionVersion(
                    id=version_id,
                    question_id=question_id,
                    version_number=1,
                    question_text=f"Navigation fixture {number}: select one option.",
                    question_type="multiple_choice",
                    allows_multiple_answers=False,
                    explanation=f"Fixture explanation {number}: option A is correct.",
                    review_status="approved",
                    publication_status="active",
                    is_flagged=False,
                    submitted_by_id=author_id,
                    reviewed_by_id=author_id,
                    reviewed_at=datetime.now(UTC),
                ),
                (
                    "question_id",
                    "version_number",
                    "question_text",
                    "question_type",
                    "allows_multiple_answers",
                    "explanation",
                    "review_status",
                    "publication_status",
                    "is_flagged",
                    "submitted_by_id",
                    "reviewed_by_id",
                ),
            )
            for position, option_text in enumerate(("Option A", "Option B"), start=1):
                ensure_row(
                    session,
                    AnswerOption(
                        id=fixture_id(f"{mode}/option/{number}/{position}"),
                        question_version_id=version_id,
                        position=position,
                        option_text=option_text,
                        is_correct=position == 1,
                    ),
                    ("question_version_id", "position", "option_text", "is_correct"),
                )
        ensure_row(
            session,
            PracticeExam(
                id=practice_exam_id,
                certification_id=certification_id,
                category_id=category_id,
                name=f"Navigation {mode} test {run_id}",
                question_count=count,
                status="published",
            ),
            ("certification_id", "category_id", "name", "question_count", "status"),
        )
        session.add(
            User(
                id=learner_id,
                email=email,
                full_name="JHEP-105 E2E Learner",
                role="learner",
                is_verified=True,
                hashed_password=hash_password(password),
            )
        )

    return {
        "email": email,
        "password": password,
        "certification_id": str(certification_id),
        "category_id": str(category_id),
        "practice_exam_id": str(practice_exam_id),
        "question_count": count,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm-local", action="store_true")
    parser.add_argument("--mode", choices=tuple(COUNTS), required=True)
    args = parser.parse_args()
    if not args.confirm_local:
        parser.error("Confirm a disposable local database with --confirm-local")
    print(json.dumps(seed_navigation_fixture(args.mode)))


if __name__ == "__main__":
    main()
