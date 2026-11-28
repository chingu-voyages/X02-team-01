"""Fresh disposable-local fixtures for JHEP-72 browser verification.

Reuses JHEP-105's isolated seed. The replacement operation is restricted
to this suite's own completed attempt and single-answer fixture question.
"""

import argparse
import json
from datetime import UTC, datetime
from uuid import UUID

from sqlmodel import Session, select

from app.core.config import settings
from app.db.session import engine
from app.models import (
    AnswerOption,
    Certification,
    ExamAttempt,
    ExamAttemptQuestion,
    PracticeExam,
    Question,
    QuestionImage,
    QuestionVersion,
    TextAnswerKey,
    User,
)
from scripts.seed_demo_exams import require_safe_local_database
from scripts.seed_navigation_e2e import seed_navigation_fixture

MARKER = "JHEP-72 E2E "
SINGLE_NAMES = ("single_correct", "single_wrong", "single_unanswered")


def seed_fixture(mode: str) -> dict:
    require_safe_local_database()
    if settings.max_exam_questions < 6:
        raise RuntimeError("JHEP-72 fixture requires MAX_EXAM_QUESTIONS >= 6")
    fixture = seed_navigation_fixture("immediate")
    cert_id = UUID(str(fixture["certification_id"]))
    category_id = UUID(str(fixture["category_id"]))
    exam_id = UUID(str(fixture["practice_exam_id"]))
    versions = {}
    with Session(engine) as session, session.begin():
        cert = session.get(Certification, cert_id)
        exam = session.get(PracticeExam, exam_id)
        originals = session.exec(
            select(QuestionVersion)
            .join(Question, Question.id == QuestionVersion.question_id)
            .where(Question.certification_id == cert_id)
            .order_by(QuestionVersion.question_text)
        ).all()
        if cert is None or exam is None or len(originals) != 3:
            raise RuntimeError("Expected a fresh three-question fixture")
        cert.name = MARKER + cert.name
        cert.feedback_mode = mode
        exam.question_count = 6
        session.add_all([cert, exam])
        author_id = originals[0].submitted_by_id
        for name, version in zip(SINGLE_NAMES, originals, strict=True):
            version.question_text = f"JHEP-72 fixture {name}: select one option."
            version.explanation = (
                None if name == "single_wrong" else f"Original explanation: {name}."
            )
            session.add(version)
            versions[name] = str(version.id)

        for name in ("multi_correct", "multi_partial", "written"):
            written = name == "written"
            question = Question(
                certification_id=cert_id,
                category_id=category_id,
                difficulty="easy",
                created_by_id=author_id,
            )
            session.add(question)
            session.flush()
            version = QuestionVersion(
                question_id=question.id,
                version_number=1,
                question_text=(
                    f"JHEP-72 fixture {name}: Δx² = 4 · 日本語 · مرحبا."
                    + (" " + "X" * 220 if name == "multi_partial" else "")
                ),
                question_type="short_answer" if written else "multiple_choice",
                allows_multiple_answers=not written,
                explanation=f"Original explanation: {name}. Δx² = 4 · 日本語",
                review_status="approved",
                publication_status="active",
                submitted_by_id=author_id,
                reviewed_by_id=author_id,
                reviewed_at=datetime.now(UTC),
            )
            session.add(version)
            session.flush()
            versions[name] = str(version.id)
            if written:
                session.add(
                    TextAnswerKey(
                        question_version_id=version.id,
                        expected_answer="JHEP72-PRIVATE-WRITTEN-KEY",
                        max_points=2,
                    )
                )
            else:
                for position in range(1, 4):
                    option_text = f"Choice {position}"
                    if name == "multi_partial" and position == 3:
                        option_text += " " + "Y" * 220
                    session.add(
                        AnswerOption(
                            question_version_id=version.id,
                            position=position,
                            option_text=option_text,
                            is_correct=position in (1, 3),
                        )
                    )
                if name == "multi_partial":
                    # Metadata only: the browser intercepts this fixture image
                    # or checks the accessible fallback; no R2 writes needed.
                    session.add(
                        QuestionImage(
                            question_version_id=version.id,
                            position=1,
                            storage_key=f"jhep72-e2e/{version.id}.png",
                            alt_text="JHEP-72 fixture diagram",
                            media_type="image/png",
                        )
                    )
    return {**fixture, "question_count": 6, "versions": versions}


def replace_fixture_version(attempt_id: UUID, version_id: UUID) -> dict[str, str]:
    """Retire only this test's own original and publish a distinct version."""
    require_safe_local_database()
    with Session(engine) as session, session.begin():
        attempt = session.get(ExamAttempt, attempt_id)
        original = session.get(QuestionVersion, version_id)
        if attempt is None or original is None or attempt.status != "submitted":
            raise RuntimeError("Expected a completed JHEP-72 fixture attempt")
        cert = session.get(Certification, attempt.certification_id)
        learner = session.get(User, attempt.user_id)
        question = session.get(Question, original.question_id)
        pinned = session.exec(
            select(ExamAttemptQuestion).where(
                ExamAttemptQuestion.attempt_id == attempt_id,
                ExamAttemptQuestion.question_version_id == version_id,
            )
        ).first()
        if (
            cert is None
            or not cert.name.startswith(MARKER)
            or learner is None
            or not learner.email.startswith("jhep105-e2e-")
            or question is None
            or question.certification_id != cert.id
            or pinned is None
            or original.question_text
            != "JHEP-72 fixture single_correct: select one option."
            or original.version_number != 1
            or original.publication_status != "active"
        ):
            raise RuntimeError("Refusing to replace a non-fixture question")
        original.publication_status = "retired"
        session.add(original)
        session.flush()
        replacement = QuestionVersion(
            question_id=original.question_id,
            version_number=2,
            question_text="JHEP72-REPLACEMENT-QUESTION",
            question_type="multiple_choice",
            explanation="JHEP72-REPLACEMENT-EXPLANATION",
            review_status="approved",
            publication_status="active",
            submitted_by_id=original.submitted_by_id,
            reviewed_by_id=original.submitted_by_id,
            reviewed_at=datetime.now(UTC),
        )
        session.add(replacement)
        session.flush()
        replacement_id = replacement.id
        for position in (1, 2):
            session.add(
                AnswerOption(
                    question_version_id=replacement_id,
                    position=position,
                    option_text=f"Replacement choice {position}",
                    is_correct=position == 2,
                )
            )
    return {"replacement_id": str(replacement_id)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm-local", action="store_true")
    parser.add_argument("--mode", choices=("immediate", "deferred"))
    parser.add_argument("--replace-version", type=UUID)
    parser.add_argument("--attempt-id", type=UUID)
    args = parser.parse_args()
    if not args.confirm_local:
        parser.error("Confirm a disposable local database with --confirm-local")
    if args.mode and not args.replace_version and not args.attempt_id:
        result = seed_fixture(args.mode)
    elif args.replace_version and args.attempt_id and not args.mode:
        result = replace_fixture_version(args.attempt_id, args.replace_version)
    else:
        parser.error("Supply --mode or both --replace-version and --attempt-id")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
