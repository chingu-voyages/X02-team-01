"""Local-only fixtures for the JHEP-203 practice-exam isolation regression.

Two published exams share one certification, category, and question bank.
Catalog fixtures are reused; each run creates a fresh verified learner.
Existing users, questions, attempts, and results are never modified or deleted.
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

QUESTION_COUNT = 3
EXAM_NAMES = ("JHEP-203 Data", "JHEP-203 Programming")


def fixture_id(name: str) -> UUID:
    return demo_uuid(f"jhep-203/attempt-isolation-e2e/v1/{name}")


def seed_attempt_isolation_fixture() -> dict:
    require_safe_local_database()
    if engine.url.get_backend_name() != "postgresql":
        raise RuntimeError("JHEP-203 requires local PostgreSQL")
    if settings.max_exam_questions < QUESTION_COUNT:
        raise RuntimeError("JHEP-203 requires MAX_EXAM_QUESTIONS >= 3")

    author_id = fixture_id("author")
    certification_id = fixture_id("certification")
    category_id = fixture_id("category")
    learner_id = uuid4()
    email = f"jhep203-e2e-{learner_id.hex}@example.test"
    password = f"Isolation1!{secrets.token_urlsafe(18)}"
    exams = []

    with Session(engine) as session, session.begin():
        ensure_row(
            session,
            User(
                id=author_id,
                email="jhep203-fixture-author@example.test",
                full_name="JHEP-203 Fixture Author",
                role="learner",
                is_verified=False,
            ),
            ("email", "role", "is_verified", "hashed_password"),
        )
        ensure_row(
            session,
            Certification(
                id=certification_id,
                name="JHEP-203 E2E Computer Science",
                code="JHEP203-E2E",
                passing_threshold_pct=65,
                feedback_mode="immediate",
                is_published=True,
            ),
            ("name", "code", "passing_threshold_pct", "feedback_mode", "is_published"),
        )
        ensure_row(
            session,
            Category(
                id=category_id,
                certification_id=certification_id,
                name="Programming Fundamentals",
                is_published=True,
            ),
            ("certification_id", "name", "is_published"),
        )

        for number in range(1, QUESTION_COUNT + 1):
            question_id = fixture_id(f"question/{number}")
            version_id = fixture_id(f"version/{number}")
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
                    question_text=f"JHEP-203 fixture question {number}: select one option.",
                    question_type="multiple_choice",
                    allows_multiple_answers=False,
                    explanation="Option A is correct for this test fixture.",
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
                        id=fixture_id(f"option/{number}/{position}"),
                        question_version_id=version_id,
                        position=position,
                        option_text=option_text,
                        is_correct=position == 1,
                    ),
                    ("question_version_id", "position", "option_text", "is_correct"),
                )

        for name in EXAM_NAMES:
            exam_id = fixture_id(f"exam/{name}")
            ensure_row(
                session,
                PracticeExam(
                    id=exam_id,
                    certification_id=certification_id,
                    category_id=category_id,
                    name=name,
                    question_count=QUESTION_COUNT,
                    status="published",
                ),
                ("certification_id", "category_id", "name", "question_count", "status"),
            )
            exams.append({"id": str(exam_id), "name": name})

        session.add(
            User(
                id=learner_id,
                email=email,
                full_name="JHEP-203 E2E Learner",
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
        "question_count": QUESTION_COUNT,
        "exams": exams,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm-local", action="store_true")
    args = parser.parse_args()
    if not args.confirm_local:
        parser.error("Confirm a disposable local database with --confirm-local")
    print(json.dumps(seed_attempt_isolation_fixture()))


if __name__ == "__main__":
    main()
