"""Seed three ten-question categories for the local learner-journey demo.

From backend/:
    python -m scripts.seed_demo_journey --confirm-local

The bank contains 30 original, automatically gradable multiple-choice questions.
Answer keys remain in answer_options; explanations are released only through
FastAPI's normal per-question submit endpoint. No ExamResponse rows are seeded.

Uses deterministic IDs. Re-running verifies existing rows and inserts nothing.
For existing disposable local databases, the optional --show-only-journey-categories
flag unpublishes other categories without deleting questions or attempts.
Never use against production or a database containing real learner data.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import NAMESPACE_URL, UUID, uuid5

from sqlmodel import Session, select

from app.db.session import engine
from app.models import (
    AnswerOption,
    Category,
    Certification,
    Question,
    QuestionVersion,
    User,
)
from scripts.seed_demo_exams import (
    DEMO_USER_EMAIL,
    DEMO_USER_ID,
    ensure_row,
    require_safe_local_database,
)


@dataclass(frozen=True)
class DemoQuestion:
    prompt: str
    options: tuple[str, str, str, str]
    correct_positions: tuple[int, ...]  # 1-based; multiple positions = multi-select
    explanation: str
    difficulty: str = "easy"


@dataclass(frozen=True)
class DemoCategory:
    slug: str
    title: str
    questions: tuple[DemoQuestion, ...]


def journey_uuid(value: str) -> UUID:
    return uuid5(NAMESPACE_URL, f"job-hackers/learner-journey/v1/{value}")


CERTIFICATION_CODE = "JHEP-DEMO-30"
CERTIFICATION_NAME = "Job Hackers Practice Exam — Demo"
PASSING_THRESHOLD = 70

CATEGORIES = (
    DemoCategory(
        slug="agile",
        title="Agile Fundamentals",
        questions=(
            DemoQuestion(
                "What does the Agile Manifesto value more than following a plan?",
                (
                    "Comprehensive documentation",
                    "Responding to change",
                    "Contract negotiation",
                    "Strictly fixed scope",
                ),
                (2,),
                "Agile values responding to change over following a plan, while recognizing value in both.",
            ),
            DemoQuestion(
                "What is the main advantage of delivering work in small increments?",
                (
                    "It eliminates testing",
                    "It prevents all changes",
                    "It enables early feedback and adaptation",
                    "It removes the need for customers",
                ),
                (3,),
                "Small increments make progress visible and help teams learn from feedback sooner.",
            ),
            DemoQuestion(
                "Which activity best supports continuous improvement?",
                (
                    "A team retrospective",
                    "Ignoring defects",
                    "Adding work without review",
                    "Skipping feedback",
                ),
                (1,),
                "Retrospectives create space to inspect how the team works and adapt its practices.",
            ),
            DemoQuestion(
                "Which behaviors help an Agile team collaborate? Select all that apply.",
                (
                    "Sharing progress openly",
                    "Seeking feedback",
                    "Withholding blockers",
                    "Working toward a common goal",
                ),
                (1, 2, 4),
                "Transparency, feedback, and shared goals support effective collaboration.",
                "medium",
            ),
            DemoQuestion(
                "What does a clear Definition of Done help a team understand?",
                (
                    "Who receives a bonus",
                    "When work meets agreed quality criteria",
                    "Which feature is most expensive",
                    "When planning is forbidden",
                ),
                (2,),
                "A Definition of Done makes the team's quality expectations explicit.",
            ),
            DemoQuestion(
                "What is a useful way to prioritize a product backlog?",
                (
                    "Sort tasks alphabetically",
                    "Always do the newest request first",
                    "Consider value, risk, and learning",
                    "Let each developer choose unrelated work",
                ),
                (3,),
                "Ordering by value, risk, and learning helps teams pursue the most important outcomes.",
            ),
            DemoQuestion(
                "What should a team do when it discovers an important new customer need?",
                (
                    "Never change the plan",
                    "Discuss the new information and adapt priorities",
                    "Hide the request",
                    "Stop measuring outcomes",
                ),
                (2,),
                "Agile planning allows teams to incorporate new information rather than blindly follow an obsolete plan.",
            ),
            DemoQuestion(
                "Which statement about user stories is most helpful?",
                (
                    "They replace every conversation",
                    "They must contain implementation code",
                    "They describe a user need and invite discussion",
                    "They cannot change",
                ),
                (3,),
                "A user story is a reminder to discuss the user's need and the value of the work.",
            ),
            DemoQuestion(
                "What is the purpose of obtaining feedback from a working product?",
                (
                    "Prove predictions can never be wrong",
                    "Avoid talking to users",
                    "Remove all uncertainty forever",
                    "Learn whether the product meets real needs",
                ),
                (4,),
                "Feedback from working software helps validate assumptions about user value.",
            ),
            DemoQuestion(
                "Which measurements are useful for assessing delivery outcomes? Select all that apply.",
                (
                    "Customer satisfaction",
                    "Defect rate",
                    "Only hours spent in meetings",
                    "Time to deliver usable value",
                ),
                (1, 2, 4),
                "Outcome measures cover usefulness, quality, and delivery speed, rather than activity alone.",
                "medium",
            ),
        ),
    ),
    DemoCategory(
        slug="scrum",
        title="Scrum Framework",
        questions=(
            DemoQuestion(
                "Who is accountable for ordering the Product Backlog?",
                (
                    "Scrum Master",
                    "Product Owner",
                    "Developers",
                    "Stakeholders as a committee",
                ),
                (2,),
                "The Product Owner is accountable for effective Product Backlog management, including ordering.",
            ),
            DemoQuestion(
                "What is the maximum duration of a Sprint under the Scrum Guide?",
                (
                    "One month or less",
                    "Exactly six weeks",
                    "One calendar quarter",
                    "Any length the team wants",
                ),
                (1,),
                "A Sprint is a fixed-length event of one month or less.",
            ),
            DemoQuestion(
                "Why do Developers hold a Daily Scrum?",
                (
                    "To approve a yearly budget",
                    "To rank individuals",
                    "To inspect progress toward the Sprint Goal and adapt the plan",
                    "To replace the Sprint Review",
                ),
                (3,),
                "The Daily Scrum helps Developers inspect progress and adapt their plan for the next day of work.",
            ),
            DemoQuestion(
                "What are the three pillars of empiricism in Scrum? Select all that apply.",
                ("Transparency", "Inspection", "Adaptation", "Prediction"),
                (1, 2, 3),
                "Scrum's empirical process control is founded on transparency, inspection, and adaptation.",
                "medium",
            ),
            DemoQuestion(
                "Which event involves inspecting the Sprint outcome with stakeholders?",
                (
                    "Sprint Planning",
                    "Sprint Retrospective",
                    "Daily Scrum",
                    "Sprint Review",
                ),
                (4,),
                "The Sprint Review inspects the Sprint's outcome and helps determine future adaptations.",
            ),
            DemoQuestion(
                "What is the commitment associated with the Increment?",
                (
                    "Product Goal",
                    "Definition of Done",
                    "Sprint Goal",
                    "Velocity target",
                ),
                (2,),
                "The Definition of Done describes the quality state required for an Increment.",
            ),
            DemoQuestion(
                "What does the Sprint Goal provide?",
                (
                    "A single objective for the Sprint",
                    "A list of annual budgets",
                    "A fixed task assignment per person",
                    "A guarantee that nothing changes",
                ),
                (1,),
                "The Sprint Goal provides a shared objective that gives the Scrum Team flexibility in how to meet it.",
            ),
            DemoQuestion(
                "What should the Scrum Team discuss during the Sprint Retrospective?",
                (
                    "Only who worked the most hours",
                    "Only the Product Owner's priorities",
                    "Ways to improve quality and effectiveness",
                    "A mandatory new organizational chart",
                ),
                (3,),
                "The Retrospective identifies useful improvements to quality and effectiveness.",
            ),
            DemoQuestion(
                "Which Scrum event establishes why the Sprint is valuable and plans the work?",
                (
                    "Sprint Planning",
                    "Sprint Review",
                    "Backlog archiving",
                    "Daily Scrum",
                ),
                (1,),
                "Sprint Planning creates a plan for the Sprint and establishes its value through the Sprint Goal.",
            ),
            DemoQuestion(
                "Who is accountable for establishing Scrum as defined in the Scrum Guide?",
                (
                    "The CEO",
                    "The Scrum Master",
                    "An external auditor",
                    "Only the Developers",
                ),
                (2,),
                "The Scrum Master is accountable for establishing Scrum and helping the team and organization use it well.",
            ),
        ),
    ),
    DemoCategory(
        slug="security",
        title="Security Essentials",
        questions=(
            DemoQuestion(
                "What does integrity mean in the CIA security triad?",
                (
                    "Information is accurate and protected from unauthorized changes",
                    "Everyone can read every file",
                    "Systems never require updates",
                    "All traffic is public",
                ),
                (1,),
                "Integrity means protecting information against unauthorized alteration.",
            ),
            DemoQuestion(
                "What does least privilege require?",
                (
                    "Give every account administrator access",
                    "Share one password among all users",
                    "Grant only access needed for assigned work",
                    "Disable audit records",
                ),
                (3,),
                "Least privilege limits permissions to those required to carry out legitimate tasks.",
            ),
            DemoQuestion(
                "Which choice is an example of multifactor authentication?",
                (
                    "Two passwords typed into the same form",
                    "A password plus a device-based security key",
                    "A longer username",
                    "Two security questions",
                ),
                (2,),
                "Multifactor authentication combines independent categories of factors, such as knowledge and possession.",
            ),
            DemoQuestion(
                "What is phishing?",
                (
                    "An encrypted backup process",
                    "A server health check",
                    "A type of network cable",
                    "Deceptive messaging intended to trick someone into an unsafe action",
                ),
                (4,),
                "Phishing uses deceptive communications to obtain information or prompt unsafe actions.",
            ),
            DemoQuestion(
                "What is a safe response to an unexpected attachment?",
                (
                    "Report it through approved channels without opening it",
                    "Run it on the main workstation",
                    "Forward it to every colleague",
                    "Disable endpoint protection",
                ),
                (1,),
                "Suspicious attachments should be reported and not opened until appropriately assessed.",
            ),
            DemoQuestion(
                "What does TLS normally protect in an HTTPS connection?",
                (
                    "A device against theft",
                    "Data in transit",
                    "The entire server against power failure",
                    "Deleted database rows",
                ),
                (2,),
                "TLS protects confidentiality and integrity of data while it travels between endpoints.",
            ),
            DemoQuestion(
                "Which activities belong to a typical incident response process? Select all that apply.",
                ("Detection", "Containment", "Recovery", "Ignoring reported incidents"),
                (1, 2, 3),
                "Detecting, containing, and recovering from an incident are core response activities.",
                "medium",
            ),
            DemoQuestion(
                "What is a benefit of network segmentation?",
                (
                    "It removes all need for authentication",
                    "It makes every system publicly reachable",
                    "It limits movement between network zones",
                    "It prevents any physical outage",
                ),
                (3,),
                "Segmentation can limit the spread of a compromise across systems.",
            ),
            DemoQuestion(
                "Why should organizations test restoring backups?",
                (
                    "To prove backups can be recovered when needed",
                    "To eliminate access controls",
                    "To avoid maintaining logs",
                    "To replace all incident-response plans",
                ),
                (1,),
                "Testing a restore verifies that backups can actually be used in an incident.",
            ),
            DemoQuestion(
                "What is authorization?",
                (
                    "Proving who a user is",
                    "Encrypting a storage device",
                    "Choosing a network port",
                    "Deciding what an authenticated user is allowed to access",
                ),
                (4,),
                "Authentication establishes identity; authorization controls permitted actions and resources.",
            ),
        ),
    ),
)


def validate_bank() -> None:
    """Reject invalid seed content before touching PostgreSQL."""
    if len(CATEGORIES) != 3 or len({c.slug for c in CATEGORIES}) != 3:
        raise ValueError("Exactly three distinct demo categories are required")
    if len({c.title for c in CATEGORIES}) != 3:
        raise ValueError("Category names must be distinct")
    for category in CATEGORIES:
        if len(category.questions) != 10:
            raise ValueError(f"{category.title} must contain exactly ten questions")
        if len({q.prompt for q in category.questions}) != 10:
            raise ValueError(f"Duplicate question text in {category.title}")
        for question in category.questions:
            if (
                not question.prompt.strip()
                or not question.explanation.strip()
                or question.difficulty not in {"easy", "medium", "hard"}
                or len(question.options) != 4
                or any(not option.strip() for option in question.options)
                or not question.correct_positions
                or len(set(question.correct_positions))
                != len(question.correct_positions)
                or any(p not in (1, 2, 3, 4) for p in question.correct_positions)
            ):
                raise ValueError(f"Invalid seed question: {question.prompt}")


def seed(*, show_only_journey_categories: bool = False) -> dict[str, int]:
    """Insert this demo bank. Only an explicit opt-in unpublishes other categories."""
    require_safe_local_database()
    validate_bank()
    counts = {
        "users": 0,
        "certifications": 0,
        "categories": 0,
        "questions": 0,
        "question_versions": 0,
        "answer_options": 0,
        "other_categories_unpublished": 0,
    }

    cert_id = journey_uuid("certification")
    with Session(engine) as session, session.begin():
        counts["users"] += ensure_row(
            session,
            User(id=DEMO_USER_ID, email=DEMO_USER_EMAIL),
            ("email",),
        )
        counts["certifications"] += ensure_row(
            session,
            Certification(
                id=cert_id,
                code=CERTIFICATION_CODE,
                name=CERTIFICATION_NAME,
                passing_threshold_pct=PASSING_THRESHOLD,
                feedback_mode="immediate",
            ),
            ("code", "name", "passing_threshold_pct", "feedback_mode"),
        )

        for category in CATEGORIES:
            category_id = journey_uuid(f"{category.slug}/category")
            counts["categories"] += ensure_row(
                session,
                Category(
                    id=category_id,
                    certification_id=cert_id,
                    name=category.title,
                    is_published=True,
                ),
                ("certification_id", "name", "is_published"),
            )
            for number, item in enumerate(category.questions, start=1):
                question_id = journey_uuid(f"{category.slug}/question/{number}")
                version_id = journey_uuid(f"{category.slug}/version/{number}")
                counts["questions"] += ensure_row(
                    session,
                    Question(
                        id=question_id,
                        certification_id=cert_id,
                        category_id=category_id,
                        difficulty=item.difficulty,
                        created_by_id=DEMO_USER_ID,
                    ),
                    ("certification_id", "category_id", "difficulty", "created_by_id"),
                )
                counts["question_versions"] += ensure_row(
                    session,
                    QuestionVersion(
                        id=version_id,
                        question_id=question_id,
                        version_number=1,
                        question_text=item.prompt,
                        question_type="multiple_choice",
                        allows_multiple_answers=len(item.correct_positions) > 1,
                        explanation=item.explanation,
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
                        "explanation",
                        "review_status",
                        "publication_status",
                        "is_flagged",
                    ),
                )
                for position, text in enumerate(item.options, start=1):
                    counts["answer_options"] += ensure_row(
                        session,
                        AnswerOption(
                            id=journey_uuid(
                                f"{category.slug}/option/{number}/{position}"
                            ),
                            question_version_id=version_id,
                            position=position,
                            option_text=text,
                            is_correct=position in item.correct_positions,
                        ),
                        (
                            "question_version_id",
                            "position",
                            "option_text",
                            "is_correct",
                        ),
                    )
        if show_only_journey_categories:
            # Explicit, local-only demo presentation option. No rows are
            # deleted and previously assigned attempts remain intact.
            our_ids = {
                journey_uuid(f"{category.slug}/category") for category in CATEGORIES
            }
            for other in session.exec(select(Category)).all():
                if other.id not in our_ids and other.is_published:
                    other.is_published = False
                    session.add(other)
                    counts["other_categories_unpublished"] += 1
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--confirm-local",
        action="store_true",
        help="Required acknowledgement: use only a disposable local PostgreSQL database",
    )
    parser.add_argument(
        "--show-only-journey-categories",
        action="store_true",
        help=(
            "On this disposable local DB, UNPUBLISH every other category "
            "(no deletion); the catalog then shows exactly these three"
        ),
    )
    args = parser.parse_args()
    if not args.confirm_local:
        parser.error("Use --confirm-local for a disposable local development database")

    inserted = seed(show_only_journey_categories=args.show_only_journey_categories)
    print("Learner-journey bank ready (new rows inserted; reruns report zero):")
    for table, count in inserted.items():
        print(f"  {table}: {count}")
    print(f"Demo learner: {DEMO_USER_ID}")
    print(f"Demo certification: {CERTIFICATION_NAME} ({journey_uuid('certification')})")
    for category in CATEGORIES:
        print(f"  {category.title}: {len(category.questions)} questions")
    if args.show_only_journey_categories:
        print("Other local categories were UNPUBLISHED, not deleted.")
    print("Answer keys were stored privately; no learner answers were pre-submitted.")


if __name__ == "__main__":
    main()
