"""Create isolated local-only fixtures for the JHEP-201 browser regression.

The fixture intentionally contains eligible published questions but no practice
exam. Playwright must create and publish the exam through the actual admin UI.
Every run uses fresh accounts and catalog records, leaving existing data alone.
The dedicated test administrator uses the normal MFA enrollment service.
"""

from __future__ import annotations

import argparse
import json
import secrets
from datetime import UTC, datetime
from uuid import uuid4

import pyotp
from sqlmodel import Session

from app.core.config import settings
from app.core.security import hash_password
from app.db.session import engine
from app.models import (
    AnswerOption,
    Category,
    Certification,
    Question,
    QuestionVersion,
    User,
)
from app.services.mfa_service import (
    begin_enrollment,
    confirm_enrollment,
    mfa_configured,
)
from scripts.seed_demo_exams import require_safe_local_database

QUESTION_COUNT = 2


def seed_publication_fixture() -> dict[str, object]:
    require_safe_local_database()
    if not mfa_configured():
        raise RuntimeError("Set a disposable local MFA_ENCRYPTION_KEY for this test.")
    if settings.max_exam_questions < QUESTION_COUNT:
        raise RuntimeError(f"MAX_EXAM_QUESTIONS must be at least {QUESTION_COUNT}.")

    run_id = uuid4().hex[:12]
    cert_id = uuid4()
    category_id = uuid4()
    cert_name = f"JHEP-201 E2E {run_id}"
    category_name = "Publication regression fixtures"
    exam_name = f"JHEP-201 practice exam {run_id}"
    accounts: dict[str, dict[str, str]] = {}
    admin_id = uuid4()

    with Session(engine) as session, session.begin():
        for role in ("administrator", "learner", "contributor"):
            email = f"jhep201-{role}-{run_id}@example.test"
            password = f"JhepE2e1!{secrets.token_urlsafe(18)}"
            user_id = admin_id if role == "administrator" else uuid4()
            session.add(
                User(
                    id=user_id,
                    email=email,
                    full_name=f"JHEP-201 E2E {role}",
                    role=role,
                    is_verified=True,
                    hashed_password=hash_password(password),
                )
            )
            accounts[role] = {"email": email, "password": password}
        session.flush()

        session.add(
            Certification(
                id=cert_id,
                name=cert_name,
                code=f"JHEP201-E2E-{run_id.upper()}",
                passing_threshold_pct=70,
                feedback_mode="immediate",
                is_published=True,
            )
        )
        session.flush()
        session.add(
            Category(
                id=category_id,
                certification_id=cert_id,
                name=category_name,
                is_published=True,
            )
        )
        session.flush()

        for number in range(1, QUESTION_COUNT + 1):
            question_id = uuid4()
            version_id = uuid4()
            session.add(
                Question(
                    id=question_id,
                    certification_id=cert_id,
                    category_id=category_id,
                    difficulty="easy",
                    created_by_id=admin_id,
                )
            )
            session.flush()
            session.add(
                QuestionVersion(
                    id=version_id,
                    question_id=question_id,
                    version_number=1,
                    question_text=f"Publication fixture {run_id}: question {number}",
                    question_type="multiple_choice",
                    allows_multiple_answers=False,
                    explanation="Option A is correct for this test fixture.",
                    review_status="approved",
                    publication_status="active",
                    is_flagged=False,
                    submitted_by_id=admin_id,
                    reviewed_by_id=admin_id,
                    reviewed_at=datetime.now(UTC),
                )
            )
            session.flush()
            for position, option_text in enumerate(("Option A", "Option B"), start=1):
                session.add(
                    AnswerOption(
                        id=uuid4(),
                        question_version_id=version_id,
                        position=position,
                        option_text=option_text,
                        is_correct=position == 1,
                    )
                )

        # Do not seed a PracticeExam: the browser must create it.

    with Session(engine) as session:
        administrator = session.get(User, admin_id)
        if administrator is None:
            raise RuntimeError("Test administrator was not created.")
        setup = begin_enrollment(session, actor=administrator)
        secret = setup["secret"]
        confirm_enrollment(session, actor=administrator, code=pyotp.TOTP(secret).now())
        accounts["administrator"]["totp_secret"] = secret

    return {
        "administrator": accounts["administrator"],
        "learner": accounts["learner"],
        "contributor": accounts["contributor"],
        "certification_id": str(cert_id),
        "certification_name": cert_name,
        "category_id": str(category_id),
        "category_name": category_name,
        "exam_name": exam_name,
        "question_count": QUESTION_COUNT,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm-local", action="store_true")
    args = parser.parse_args()
    if not args.confirm_local:
        parser.error("Confirm a disposable local database with --confirm-local")
    print(json.dumps(seed_publication_fixture()))


if __name__ == "__main__":
    main()
