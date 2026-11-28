"""Local-only mixed-question fixture for JHEP-89 recovery regression tests."""

import argparse
import json
from uuid import UUID

from sqlmodel import Session, select

from app.db.session import engine
from app.models import AnswerOption, Question, QuestionVersion, TextAnswerKey
from scripts.seed_demo_exams import require_safe_local_database
from scripts.seed_navigation_e2e import seed_navigation_fixture


def seed_mixed_recovery_fixture() -> dict[str, str | int]:
    require_safe_local_database()
    # This helper always inserts a fresh bank and verified learner. No attempt
    # has been started, so only its new fixture versions are customized.
    fixture = seed_navigation_fixture("immediate")
    certification_id = UUID(str(fixture["certification_id"]))
    with Session(engine) as session, session.begin():
        versions = session.exec(
            select(QuestionVersion)
            .join(Question, Question.id == QuestionVersion.question_id)
            .where(Question.certification_id == certification_id)
            .order_by(QuestionVersion.id)
        ).all()
        if len(versions) != 3:
            raise RuntimeError("Expected exactly three new fixture questions")
        single, multiple, written = versions
        single.question_text = "Recovery QA: select one answer."
        multiple.question_text = "Recovery QA: select multiple answers."
        multiple.allows_multiple_answers = True
        written.question_text = "Recovery QA: explain your reasoning."
        written.question_type = "short_answer"
        written.explanation = "A written response is reviewed separately."
        for option in session.exec(
            select(AnswerOption).where(AnswerOption.question_version_id == written.id)
        ).all():
            session.delete(option)
        session.add(
            TextAnswerKey(
                question_version_id=written.id,
                expected_answer="A reasoned explanation.",
            )
        )
        session.add_all([single, multiple, written])
    return fixture


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm-local", action="store_true")
    args = parser.parse_args()
    if not args.confirm_local:
        parser.error("Confirm a disposable local database with --confirm-local")
    print(json.dumps(seed_mixed_recovery_fixture()))


if __name__ == "__main__":
    main()
