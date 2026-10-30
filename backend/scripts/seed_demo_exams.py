"""Seed original, local-only demo questions for JHEP-29.

Run from backend/: python -m scripts.seed_demo_exams --confirm-local

Only inserts deterministic demo records. Does not delete or change unrelated
rows. Rerunning is safe, and mismatches fail rather than overwrite data.
Never run against production or a database holding real learner data.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import NAMESPACE_URL, UUID, uuid5

from sqlmodel import Session

from app.db.session import engine
from app.models import (
    AnswerOption,
    Category,
    Certification,
    Question,
    QuestionVersion,
    TextAnswerKey,
    User,
)


@dataclass(frozen=True)
class SampleQuestion:
    text: str
    choices: tuple[str, ...] = ()
    correct: tuple[int, ...] = ()  # 1-based answer-option positions
    expected_answer: str | None = None
    difficulty: str = "easy"


@dataclass(frozen=True)
class DemoCertification:
    slug: str
    code: str
    name: str
    questions: tuple[SampleQuestion, ...]


def demo_uuid(value: str) -> UUID:
    return uuid5(NAMESPACE_URL, f"job-hackers/jhep-29/demo-v1/{value}")


DEMO_USER_ID = demo_uuid("learner")
DEMO_USER_EMAIL = "jhep29-demo-learner@example.test"

PSM_QUESTIONS = (
    SampleQuestion(
        "Who is accountable for ordering the Product Backlog?",
        (
            "The Scrum Master",
            "The Product Owner",
            "The Developers",
            "The project sponsor",
        ),
        (2,),
    ),
    SampleQuestion(
        "What is the maximum duration of a Sprint according to the Scrum Guide?",
        ("One month or less", "Exactly two weeks", "Six weeks", "Any length"),
        (1,),
    ),
    SampleQuestion(
        "What is the primary purpose of the Daily Scrum?",
        (
            "Report individual hours",
            "Inspect progress toward the Sprint Goal and adapt the Sprint Backlog",
            "Approve a budget",
            "Replace the Sprint Review",
        ),
        (2,),
    ),
    SampleQuestion(
        "Which of these are Scrum pillars? Select all that apply.",
        ("Transparency", "Inspection", "Adaptation", "Prediction"),
        (1, 2, 3),
        difficulty="medium",
    ),
    SampleQuestion(
        "Which item defines the quality requirements for an Increment?",
        ("Product Goal", "Definition of Done", "Release calendar", "Stakeholder list"),
        (2,),
    ),
    SampleQuestion(
        "Which Scrum event inspects the outcome of the Sprint with stakeholders?",
        ("Sprint Planning", "Daily Scrum", "Sprint Review", "Sprint Retrospective"),
        (3,),
    ),
    SampleQuestion(
        "What is the main purpose of the Sprint Retrospective?",
        (
            "Plan ways to increase quality and effectiveness",
            "Approve a product budget",
            "Estimate all future work",
            "Assign permanent roles",
        ),
        (1,),
    ),
    SampleQuestion(
        "Who is accountable for establishing Scrum as defined in the Scrum Guide?",
        ("Product Owner", "Scrum Master", "Stakeholders", "Project Management Office"),
        (2,),
    ),
    SampleQuestion(
        "Which three accountabilities form a Scrum Team?",
        (
            "Analyst, manager, sponsor",
            "Product Owner, Scrum Master, Developers",
            "Tester, architect, manager",
            "Customer, project lead, accountant",
        ),
        (2,),
    ),
    SampleQuestion(
        "What does the Sprint Goal provide?",
        (
            "A single objective for the Sprint",
            "A detailed annual budget",
            "Individual performance rankings",
            "A contract that cannot change",
        ),
        (1,),
    ),
    SampleQuestion(
        "Which statement about the Product Backlog is accurate?",
        (
            "It is a fixed document",
            "It is an emergent, ordered list of what is needed to improve the product",
            "Only the Scrum Master can view it",
            "It must be empty at Sprint Planning",
        ),
        (2,),
    ),
    SampleQuestion(
        "Which commitments are associated with Scrum artifacts? Select all that apply.",
        ("Product Goal", "Sprint Goal", "Definition of Done", "Annual budget"),
        (1, 2, 3),
        difficulty="medium",
    ),
    SampleQuestion(
        "What is backlog refinement?",
        (
            "Breaking down and further defining Product Backlog items",
            "A mandatory Scrum event of fixed duration",
            "Closing completed Sprints",
            "Signing employment agreements",
        ),
        (1,),
    ),
    SampleQuestion(
        "What is the Product Goal?",
        (
            "A future state of the product that guides planning",
            "A list of individual tasks",
            "The same as a Sprint Retrospective",
            "A required daily report",
        ),
        (1,),
    ),
    SampleQuestion(
        "In your own words, explain what the Product Owner is accountable for.",
        expected_answer="Maximizing the value of the product resulting from the work of the Scrum Team.",
        difficulty="medium",
    ),
)

SECURITY_QUESTIONS = (
    SampleQuestion(
        "What is the 'I' in the CIA triad?",
        ("Identity", "Integrity", "Inspection", "Interoperability"),
        (2,),
    ),
    SampleQuestion(
        "What does the principle of least privilege mean?",
        (
            "Give every user administrator rights",
            "Provide only the access needed for assigned tasks",
            "Disable access logs",
            "Share one account across the team",
        ),
        (2,),
    ),
    SampleQuestion(
        "Which security control adds a second independent authentication factor?",
        (
            "Multifactor authentication",
            "A longer username",
            "A password hint",
            "An additional browser tab",
        ),
        (1,),
    ),
    SampleQuestion(
        "What is phishing?",
        (
            "A type of encrypted backup",
            "Deceptive messaging intended to trick people into disclosing information or taking actions",
            "An approved software update",
            "A network routing protocol",
        ),
        (2,),
    ),
    SampleQuestion(
        "Which action best reduces lateral movement after a host is compromised?",
        (
            "Disable all monitoring",
            "Network segmentation",
            "Reuse local admin passwords",
            "Publish the access list",
        ),
        (2,),
    ),
    SampleQuestion(
        "Why are cryptographic hashes useful?",
        (
            "They guarantee confidentiality",
            "They can help detect unauthorized changes to data",
            "They replace access control",
            "They automatically restore backups",
        ),
        (2,),
    ),
    SampleQuestion(
        "What does TLS primarily protect during a typical HTTPS session?",
        (
            "Data in transit",
            "A device from physical theft",
            "The availability of all systems",
            "Data that was permanently deleted",
        ),
        (1,),
    ),
    SampleQuestion(
        "What is authorization?",
        (
            "Verifying who a user is",
            "Deciding which resources an authenticated user may access",
            "Hashing a disk",
            "Assigning an IP address",
        ),
        (2,),
    ),
    SampleQuestion(
        "What is an effective response to a suspicious email attachment?",
        (
            "Open it in production",
            "Forward it to everyone",
            "Follow organizational reporting procedures and avoid opening it",
            "Disable antivirus",
        ),
        (3,),
    ),
    SampleQuestion(
        "Which activities are commonly part of incident response? Select all that apply.",
        ("Detection", "Containment", "Recovery", "Ignoring alerts"),
        (1, 2, 3),
        difficulty="medium",
    ),
    SampleQuestion(
        "What is a primary purpose of an offline backup?",
        (
            "Make all files public",
            "Help restore data after destructive events",
            "Replace all audit logs",
            "Prevent any possible outage",
        ),
        (2,),
    ),
    SampleQuestion(
        "In risk analysis, which two considerations are commonly evaluated?",
        (
            "Color and file extension",
            "Likelihood and impact",
            "Username and time zone",
            "Device brand and monitor size",
        ),
        (2,),
    ),
    SampleQuestion(
        "Which control can help mitigate password-spraying attacks?",
        (
            "Removing authentication",
            "Multifactor authentication and appropriate rate limiting",
            "Reusing credentials",
            "Publishing password rules",
        ),
        (2,),
    ),
    SampleQuestion(
        "What is the primary purpose of centralized security logging?",
        (
            "Delete audit evidence",
            "Support detection and investigation of suspicious activity",
            "Avoid all access reviews",
            "Replace endpoint controls",
        ),
        (2,),
    ),
    SampleQuestion(
        "In your own words, explain one reason organizations test backup restoration.",
        expected_answer="To verify backed-up data can actually be recovered when needed.",
        difficulty="medium",
    ),
)

CERTIFICATIONS = (
    DemoCertification(
        "psm1",
        "JHEP29-DEMO-PSM1",
        "Professional Scrum Master I (PSM I) — Demo",
        PSM_QUESTIONS,
    ),
    DemoCertification(
        "secplus", "JHEP29-DEMO-SECPLUS", "CompTIA Security+ — Demo", SECURITY_QUESTIONS
    ),
)


def require_safe_local_database() -> None:
    """Defense against accidentally pointing the script at a remote database."""
    url = engine.url
    if url.host not in {"127.0.0.1", "localhost", "::1"}:
        raise RuntimeError("Refusing to seed: PostgreSQL host is not local")
    if not url.database or "prod" in url.database.lower():
        raise RuntimeError("Refusing to seed a database with a production-looking name")


def ensure_row(session: Session, row: object, check: tuple[str, ...]) -> bool:
    """Insert a row once; refuse to mutate an existing demo record."""
    existing = session.get(type(row), row.id)
    if existing is not None:
        for attribute in check:
            if getattr(existing, attribute) != getattr(row, attribute):
                raise RuntimeError(
                    f"Demo row conflict: {type(row).__name__} {row.id}, "
                    f"field {attribute}. No existing record was modified."
                )
        return False
    session.add(row)
    session.flush()
    return True


def seed() -> dict[str, int]:
    require_safe_local_database()
    inserted = {
        "users": 0,
        "certifications": 0,
        "categories": 0,
        "questions": 0,
        "question_versions": 0,
        "answer_options": 0,
        "text_answer_keys": 0,
    }
    with Session(engine) as session, session.begin():
        inserted["users"] += ensure_row(
            session, User(id=DEMO_USER_ID, email=DEMO_USER_EMAIL), ("email",)
        )
        for cert in CERTIFICATIONS:
            cert_id = demo_uuid(f"{cert.slug}/certification")
            category_id = demo_uuid(f"{cert.slug}/category")
            inserted["certifications"] += ensure_row(
                session,
                Certification(
                    id=cert_id,
                    code=cert.code,
                    name=cert.name,
                    passing_threshold_pct=65,
                    feedback_mode="immediate",
                ),
                ("code", "name"),
            )
            inserted["categories"] += ensure_row(
                session,
                Category(
                    id=category_id, certification_id=cert_id, name="Core concepts"
                ),
                ("certification_id", "name"),
            )
            for number, item in enumerate(cert.questions, start=1):
                q_id = demo_uuid(f"{cert.slug}/question/{number}")
                v_id = demo_uuid(f"{cert.slug}/version/{number}")
                assert bool(item.choices) != bool(item.expected_answer)
                if item.choices:
                    assert len(item.choices) >= 2
                    assert item.correct
                    assert all(1 <= pos <= len(item.choices) for pos in item.correct)
                inserted["questions"] += ensure_row(
                    session,
                    Question(
                        id=q_id,
                        certification_id=cert_id,
                        category_id=category_id,
                        difficulty=item.difficulty,
                        created_by_id=DEMO_USER_ID,
                    ),
                    ("certification_id", "category_id", "difficulty", "created_by_id"),
                )
                inserted["question_versions"] += ensure_row(
                    session,
                    QuestionVersion(
                        id=v_id,
                        question_id=q_id,
                        version_number=1,
                        question_text=item.text,
                        question_type="multiple_choice"
                        if item.choices
                        else "short_answer",
                        allows_multiple_answers=len(item.correct) > 1,
                        review_status="approved",
                        publication_status="active",
                        is_flagged=False,
                        submitted_by_id=DEMO_USER_ID,
                        reviewed_by_id=DEMO_USER_ID,
                        reviewed_at=datetime.now(UTC),
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
                if item.choices:
                    for position, option_text in enumerate(item.choices, start=1):
                        inserted["answer_options"] += ensure_row(
                            session,
                            AnswerOption(
                                id=demo_uuid(f"{cert.slug}/option/{number}/{position}"),
                                question_version_id=v_id,
                                position=position,
                                option_text=option_text,
                                is_correct=position in item.correct,
                            ),
                            (
                                "question_version_id",
                                "position",
                                "option_text",
                                "is_correct",
                            ),
                        )
                else:
                    inserted["text_answer_keys"] += ensure_row(
                        session,
                        TextAnswerKey(
                            id=demo_uuid(f"{cert.slug}/text-key/{number}"),
                            question_version_id=v_id,
                            expected_answer=item.expected_answer,
                        ),
                        ("question_version_id", "expected_answer"),
                    )
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
    counts = seed()
    print("Seed complete (new rows inserted; re-runs should report zero):")
    for table, count in counts.items():
        print(f"  {table}: {count}")
    print(f"Demo learner UUID: {DEMO_USER_ID}")
    for cert in CERTIFICATIONS:
        print(
            f"{cert.code}: {demo_uuid(f'{cert.slug}/certification')} "
            f"({len(cert.questions)} questions)"
        )
    print("Not affiliated with certification issuers; original demo questions only.")


if __name__ == "__main__":
    main()
