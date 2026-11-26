"""Seed five submitted short-answer responses for the JHEP-122 grading demo.

From backend/:
    python -m scripts.seed_manual_grading_demo --confirm-local

Creates a dedicated "Manual Grading Demo" certification with one submitted
learner attempt of five approved short-answer questions, whose written
responses wait in the manual-grading queue with `ungraded` grade rows.

Reuses the demo learner from scripts.seed_demo_exams — run that seed first.
Deterministic IDs: re-running verifies existing rows and inserts nothing.

Note on essays: the question_versions type check still only permits
'multiple_choice' and 'short_answer' (JHEP-120's scope), so essays cannot
exist in the database yet. The grading pipeline is already essay-ready and
picks essays up automatically once JHEP-120 lands the type.

Never use against production or a database containing real learner data.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from uuid import NAMESPACE_URL, UUID, uuid5

from sqlmodel import Session, select

from app.db.session import engine
from app.models import (
    Category,
    Certification,
    ExamAttempt,
    ExamAttemptQuestion,
    ExamQuestionGrade,
    ExamResponse,
    ExamResult,
    Question,
    QuestionVersion,
    TextAnswerKey,
    User,
)
from scripts.seed_demo_exams import (
    DEMO_USER_EMAIL,
    ensure_row,
    require_safe_local_database,
)

CERT_SLUG = "manual-grading-demo"
THRESHOLD_PCT = 70


def demo_id(value: str) -> UUID:
    return uuid5(NAMESPACE_URL, f"job-hackers/manual-grading-demo/v1/{value}")


@dataclass(frozen=True)
class DemoItem:
    """One seeded short-answer question with its learner response."""

    number: int
    prompt: str
    expected: str
    max_points: int
    learner_answer: str


ITEMS = (
    DemoItem(
        1,
        "In one or two sentences, what is the difference between a process "
        "and a thread?",
        "A process is an independent program with its own memory space, "
        "while a thread is a lightweight unit of execution sharing the "
        "process's memory.",
        2,
        "A process runs on its own with its own memory; threads run inside "
        "a process and share its memory.",
    ),
    DemoItem(
        2,
        "Why is HTTPS preferred over HTTP for authentication flows?",
        "HTTPS encrypts the transport so credentials and tokens cannot be "
        "read or modified in transit (confidentiality and integrity).",
        2,
        "Because HTTPS encrypts the traffic so passwords cannot be sniffed "
        "on the network.",
    ),
    DemoItem(
        3,
        "Name the three database normalization rules up to 3NF and give a "
        "one-line description for each.",
        "1NF: atomic values; 2NF: no partial dependency on a composite "
        "key; 3NF: no transitive dependency of non-key attributes on the "
        "key.",
        3,
        "1NF atomic columns, 2NF remove partial dependencies, 3NF remove "
        "transitive dependencies.",
    ),
    DemoItem(
        4,
        "What does the ACID acronym guarantee in a database transaction?",
        "Atomicity, Consistency, Isolation, Durability — all-or-nothing "
        "execution with valid state, concurrency safety and persistence.",
        2,
        "Atomicity, Consistency, Isolation and Durability guarantees for transactions.",
    ),
    DemoItem(
        5,
        "Give one reason a JWT access token should be short-lived.",
        "A short lifetime limits the damage window if the token is "
        "stolen; refresh tokens renew access safely.",
        1,
        "So a stolen token stops working quickly and the risk window is small.",
    ),
)


def seed() -> dict[str, int]:
    require_safe_local_database()
    inserted = {
        "certification": 0,
        "category": 0,
        "question_versions": 0,
        "text_answer_keys": 0,
        "attempt": 0,
        "attempt_questions": 0,
        "responses": 0,
        "ungraded_grades": 0,
        "result": 0,
    }

    with Session(engine) as session:
        learner = session.exec(
            select(User).where(User.email == DEMO_USER_EMAIL)
        ).first()
        if learner is None:
            raise RuntimeError(
                f"Demo learner {DEMO_USER_EMAIL} not found — run "
                "`python -m scripts.seed_demo_exams --confirm-local` first."
            )

        cert_id = demo_id(f"{CERT_SLUG}/certification")
        ensure_row(
            session,
            Certification(
                id=cert_id,
                name="Manual Grading Demo (Written Responses)",
                code=f"JHEP122-DEMO-{CERT_SLUG.upper()}",
                passing_threshold_pct=THRESHOLD_PCT,
            ),
            ("name", "code", "passing_threshold_pct"),
        )
        inserted["certification"] += 1

        category_id = demo_id(f"{CERT_SLUG}/category")
        ensure_row(
            session,
            Category(
                id=category_id, certification_id=cert_id, name="Written Responses"
            ),
            ("certification_id", "name"),
        )
        inserted["category"] += 1

        now = datetime.now(UTC)
        attempt_id = demo_id(f"{CERT_SLUG}/attempt")

        ensure_row(
            session,
            ExamAttempt(
                id=attempt_id,
                user_id=learner.id,
                certification_id=cert_id,
                status="submitted",
                question_count=len(ITEMS),
                passing_threshold_pct=THRESHOLD_PCT,
                submitted_at=now,
            ),
            ("user_id", "certification_id", "status", "question_count"),
        )
        inserted["attempt"] += 1

        ensure_row(
            session,
            ExamResult(
                id=demo_id(f"{CERT_SLUG}/result"),
                attempt_id=attempt_id,
                points_earned=0,
                points_possible=0,
                score_pct=Decimal(0),
                threshold_pct=THRESHOLD_PCT,
                passed=None,
            ),
            ("attempt_id",),
        )
        inserted["result"] += 1

        for item in ITEMS:
            question_id = demo_id(f"{CERT_SLUG}/question/{item.number}")
            version_id = demo_id(f"{CERT_SLUG}/version/{item.number}")

            ensure_row(
                session,
                Question(
                    id=question_id,
                    certification_id=cert_id,
                    category_id=category_id,
                    difficulty="medium" if item.number % 2 == 0 else "easy",
                    created_by_id=learner.id,
                ),
                ("certification_id", "category_id", "difficulty", "created_by_id"),
            )
            ensure_row(
                session,
                QuestionVersion(
                    id=version_id,
                    question_id=question_id,
                    version_number=1,
                    question_text=item.prompt,
                    question_type="short_answer",
                    allows_multiple_answers=False,
                    review_status="approved",
                    publication_status="active",
                    is_flagged=False,
                    submitted_by_id=learner.id,
                    reviewed_by_id=learner.id,
                    reviewed_at=now,
                ),
                (
                    "question_id",
                    "version_number",
                    "question_text",
                    "question_type",
                    "allows_multiple_answers",
                    "review_status",
                    "publication_status",
                    "is_flagged",
                ),
            )
            inserted["question_versions"] += 1

            ensure_row(
                session,
                TextAnswerKey(
                    id=demo_id(f"{CERT_SLUG}/text-key/{item.number}"),
                    question_version_id=version_id,
                    expected_answer=item.expected,
                    max_points=item.max_points,
                ),
                ("question_version_id", "expected_answer"),
            )
            inserted["text_answer_keys"] += 1

            ensure_row(
                session,
                ExamAttemptQuestion(
                    id=demo_id(f"{CERT_SLUG}/attempt-question/{item.number}"),
                    attempt_id=attempt_id,
                    question_id=question_id,
                    question_version_id=version_id,
                    position=item.number,
                ),
                ("attempt_id", "question_id", "question_version_id", "position"),
            )
            inserted["attempt_questions"] += 1

            ensure_row(
                session,
                ExamResponse(
                    id=demo_id(f"{CERT_SLUG}/response/{item.number}"),
                    attempt_id=attempt_id,
                    question_id=question_id,
                    question_version_id=version_id,
                    position=item.number,
                    text_response=item.learner_answer,
                    is_submitted=True,
                    question_submitted_at=now,
                ),
                ("attempt_id", "question_version_id", "position"),
            )
            inserted["responses"] += 1

            ensure_row(
                session,
                ExamQuestionGrade(
                    id=demo_id(f"{CERT_SLUG}/grade/{item.number}"),
                    attempt_id=attempt_id,
                    question_id=question_id,
                    question_version_id=version_id,
                    outcome="ungraded",
                    points_earned=0,
                    max_points=item.max_points,
                ),
                ("attempt_id", "question_version_id", "outcome"),
            )
            inserted["ungraded_grades"] += 1

        session.commit()

    return inserted


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--confirm-local",
        action="store_true",
        help="Confirm this is a disposable, local-only development database",
    )
    args = parser.parse_args()
    if not args.confirm_local:
        parser.error("Use --confirm-local ONLY after confirming the DB is disposable")
    try:
        counts = seed()
    except RuntimeError as exc:
        parser.exit(1, f"Seed refused: {exc}\n")
    print("Seed complete (rows ensured: inserted on first run, verified on re-runs):")
    for table, count in counts.items():
        print(f"  {table}: {count}")
    print(
        "\nFive submitted short-answer responses now wait in the "
        "manual-grading queue for the Manual Grading Demo certification."
    )


if __name__ == "__main__":
    main()
