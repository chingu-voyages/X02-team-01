"""Create isolated JHEP-120 fixtures on a disposable local PostgreSQL database.

Each invocation INSERTS a new catalog, four question versions and new accounts.
It never updates/deletes existing data or starts an attempt. The JSON output
contains generated LOCAL test credentials; do not commit it or share traces.
"""

from __future__ import annotations

import argparse
import json
import secrets
from datetime import UTC, datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy.engine import URL

if TYPE_CHECKING:
    from sqlmodel import Session


def validate_seed_target(url: URL) -> None:
    """Refuse non-PostgreSQL, non-loopback and production-looking databases."""
    if url.get_backend_name() != "postgresql":
        raise RuntimeError("Essay fixtures require PostgreSQL")
    if url.host not in {"localhost", "127.0.0.1", "::1"}:
        raise RuntimeError("Refusing to seed: PostgreSQL host is not local")
    if {"host", "hostaddr", "service", "servicefile", "dbname"} & set(url.query):
        raise RuntimeError("Refusing connection-query overrides for fixture seeding")
    if not url.database or "prod" in url.database.lower():
        raise RuntimeError("Refusing to seed a production-looking or unnamed database")


def validate_mode(mode: str) -> None:
    if mode not in {"immediate", "deferred"}:
        raise ValueError("Feedback mode must be immediate or deferred")


def create_fixture_rows(session: Session, mode: str) -> dict:
    """Insert new rows in FK order; the caller owns the transaction."""
    from app.core.security import hash_password
    from app.models import (
        AnswerOption,
        Category,
        Certification,
        PracticeExam,
        Question,
        QuestionVersion,
        TextAnswerKey,
        User,
    )

    validate_mode(mode)
    run_id = uuid4().hex
    password = f"EssayQA1!{secrets.token_urlsafe(18)}"
    reviewer_password = f"ReviewQA1!{secrets.token_urlsafe(18)}"
    other_password = f"OtherQA1!{secrets.token_urlsafe(18)}"
    author = User(
        email=f"jhep120-author-{run_id}@example.test",
        full_name="JHEP-120 non-login fixture author",
        role="learner",
        is_verified=False,
    )
    learner = User(
        email=f"jhep120-learner-{run_id}@example.test",
        full_name="JHEP-120 QA Learner",
        role="learner",
        is_verified=True,
        hashed_password=hash_password(password),
    )
    reviewer = User(
        email=f"jhep120-reviewer-{run_id}@example.test",
        full_name="JHEP-120 QA Essay Reviewer",
        role="contributor",
        is_verified=True,
        hashed_password=hash_password(reviewer_password),
        grade_essays=True,
        grade_short_answers=False,
    )
    other = User(
        email=f"jhep120-other-{run_id}@example.test",
        full_name="JHEP-120 Other Learner",
        role="learner",
        is_verified=True,
        hashed_password=hash_password(other_password),
    )
    certification = Certification(
        code=f"JHEP120-QA-{run_id}",
        name=f"JHEP-120 Essay QA ({mode}) {run_id[:8]}",
        feedback_mode=mode,
        passing_threshold_pct=65,
        is_published=True,
    )
    session.add_all([author, learner, reviewer, other, certification])
    session.flush()
    category = Category(
        certification_id=certification.id,
        name="Essay experience — isolated QA",
        is_published=True,
    )
    session.add(category)
    session.flush()

    # More than one essay exercises per-question drafts and out-of-order Finish.
    specs = (
        (
            "essay",
            "Explain how you would protect a learner's work during a network failure.",
        ),
        (
            "essay",
            "Describe an accessible exam interface. Explain your navigation choices.",
        ),
        (
            "multiple_choice",
            "Which action preserves a learner's work after a failed save?",
        ),
        (
            "short_answer",
            "Name one benefit of keeping a draft while navigating an exam.",
        ),
    )
    questions = []
    for kind, prompt in specs:
        question = Question(
            certification_id=certification.id,
            category_id=category.id,
            difficulty="medium",
            created_by_id=author.id,
        )
        session.add(question)
        session.flush()
        version = QuestionVersion(
            question_id=question.id,
            version_number=1,
            question_text=prompt,
            question_type=kind,
            allows_multiple_answers=False,
            explanation="Fixture explanation: retain the learner's response.",
            review_status="approved",
            publication_status="active",
            submitted_by_id=author.id,
            reviewed_by_id=author.id,
            reviewed_at=datetime.now(UTC),
        )
        session.add(version)
        session.flush()
        correct_option_id = None
        if kind == "multiple_choice":
            for position, label in enumerate(
                ("Keep the response and offer retry", "Discard the response"), start=1
            ):
                option = AnswerOption(
                    question_version_id=version.id,
                    position=position,
                    option_text=label,
                    is_correct=position == 1,
                )
                session.add(option)
                if position == 1:
                    correct_option_id = str(option.id)
        else:
            session.add(
                TextAnswerKey(
                    question_version_id=version.id,
                    expected_answer="PRIVATE_JHEP120_KEY: retain work and explain the next action.",
                    max_points=2,
                )
            )
        questions.append(
            {
                "question_id": str(question.id),
                "version_id": str(version.id),
                "question_type": kind,
                "correct_option_id": correct_option_id,
            }
        )
    exam = PracticeExam(
        certification_id=certification.id,
        category_id=category.id,
        name=f"JHEP-120 Essay QA {run_id[:8]}",
        question_count=len(specs),
        status="published",
    )
    session.add(exam)
    session.flush()
    return {
        "run_id": run_id,
        "mode": mode,
        "email": learner.email,
        "password": password,
        "reviewer_email": reviewer.email,
        "reviewer_password": reviewer_password,
        "other_email": other.email,
        "other_password": other_password,
        "certification_id": str(certification.id),
        "category_id": str(category.id),
        "practice_exam_id": str(exam.id),
        "exam_name": exam.name,
        "question_count": len(specs),
        "questions": questions,
    }


def seed_essay_fixture(mode: str) -> dict:
    from sqlmodel import Session

    from app.core.config import settings
    from app.db.session import engine

    validate_mode(mode)
    validate_seed_target(engine.url)
    if settings.max_exam_questions < 4:
        raise RuntimeError("Essay fixtures require MAX_EXAM_QUESTIONS >= 4")
    with Session(engine) as session, session.begin():
        return create_fixture_rows(session, mode)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm-local", action="store_true")
    parser.add_argument("--mode", choices=("immediate", "deferred"), default="deferred")
    args = parser.parse_args()
    if not args.confirm_local:
        parser.error("Confirm a disposable local database with --confirm-local")
    print(json.dumps(seed_essay_fixture(args.mode)))


if __name__ == "__main__":
    main()
