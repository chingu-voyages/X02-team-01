"""Add a written question to a fresh, local-only review test exam.

Reuse the isolated navigation fixture. The new question and count change
belong only to the newly created test catalog, before any attempt exists.
Never change an existing learner's exam or historical question version.
"""

import argparse
import json
from datetime import UTC, datetime
from uuid import UUID

from sqlmodel import Session, select

from app.core.config import settings
from app.db.session import engine
from app.models import PracticeExam, Question, QuestionVersion, TextAnswerKey
from scripts.seed_demo_exams import require_safe_local_database
from scripts.seed_navigation_e2e import seed_navigation_fixture


def seed_completed_review_fixture() -> dict[str, str | int]:
    require_safe_local_database()
    if settings.max_exam_questions < 4:
        raise RuntimeError("JHEP-37 mixed fixture requires MAX_EXAM_QUESTIONS >= 4")

    fixture = seed_navigation_fixture("immediate")
    certification_id = UUID(str(fixture["certification_id"]))
    category_id = UUID(str(fixture["category_id"]))
    practice_exam_id = UUID(str(fixture["practice_exam_id"]))

    with Session(engine) as session, session.begin():
        existing_question = session.exec(
            select(Question).where(Question.certification_id == certification_id)
        ).first()
        exam = session.get(PracticeExam, practice_exam_id)
        if existing_question is None or exam is None:
            raise RuntimeError("Fresh navigation fixture is incomplete")

        question = Question(
            certification_id=certification_id,
            category_id=category_id,
            difficulty="easy",
            created_by_id=existing_question.created_by_id,
        )
        session.add(question)
        session.flush()

        version = QuestionVersion(
            question_id=question.id,
            version_number=1,
            question_text="Explain the difference between processes and threads. "
            + "X" * 220,
            question_type="short_answer",
            explanation="REVIEW-FIXTURE-EXPLANATION: processes and threads differ.",
            review_status="approved",
            publication_status="active",
            submitted_by_id=existing_question.created_by_id,
            reviewed_by_id=existing_question.created_by_id,
            reviewed_at=datetime.now(UTC),
        )
        session.add(version)
        session.flush()
        session.add(
            TextAnswerKey(
                question_version_id=version.id,
                expected_answer="REVIEW-FIXTURE-KEY: threads share process memory.",
                max_points=2,
            )
        )
        exam.question_count = 4
        session.add(exam)

    fixture["question_count"] = 4
    return fixture


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm-local", action="store_true")
    args = parser.parse_args()
    if not args.confirm_local:
        parser.error("Confirm a disposable local database with --confirm-local")
    print(json.dumps(seed_completed_review_fixture()))


if __name__ == "__main__":
    main()
