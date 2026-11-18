from app.repositories.question_repository import (
    Question,
    QuestionOption,
)

# Fixed sample data for unit tests; default app wiring uses
# SQLModelQuestionRepository. Every review/publication/flag combination is
# represented so that the delivery filter can be tested from both sides.
_QUESTION_BANK: list[Question] = [
    # Eligible: approved, active and not flagged
    Question(
        id="v-1004",
        question_id="q-1004",
        question_text="Which Scrum event is timeboxed to 15 minutes?",
        question_type="multiple_choice",
        difficulty="easy",
        review_status="approved",
        publication_status="active",
        is_flagged=False,
        options=[
            QuestionOption(
                position=1,
                option_text="Daily Scrum",
                is_correct=True,
            ),
            QuestionOption(
                position=2,
                option_text="Sprint Review",
                is_correct=False,
            ),
        ],
    ),
    # Eligible: short-answer variant, also approved/active/unflagged
    Question(
        id="v-1005",
        question_id="q-1005",
        question_text="Name the artifact that lists ordered work for a Sprint.",
        question_type="short_answer",
        difficulty="medium",
        review_status="approved",
        publication_status="active",
        is_flagged=False,
        expected_answer="Sprint Backlog",
    ),
    # Eligible: multi-select variant, also approved/active/unflagged
    Question(
        id="v-1011",
        question_id="q-1011",
        question_text="Which of these are Scrum values?",
        question_type="multiple_choice",
        difficulty="medium",
        review_status="approved",
        publication_status="active",
        is_flagged=False,
        allows_multiple_answers=True,
        options=[
            QuestionOption(
                position=1,
                option_text="Focus",
                is_correct=True,
            ),
            QuestionOption(
                position=2,
                option_text="Synergy",
                is_correct=False,
            ),
            QuestionOption(
                position=3,
                option_text="Respect",
                is_correct=True,
            ),
        ],
    ),
    # Excluded: approved but not yet published
    Question(
        id="v-1006",
        question_id="q-1006",
        question_text="What does the Scrum Master remove?",
        question_type="multiple_choice",
        difficulty="easy",
        review_status="approved",
        publication_status="draft",
        is_flagged=False,
        options=[
            QuestionOption(
                position=1,
                option_text="Impediments",
                is_correct=True,
            ),
            QuestionOption(
                position=2,
                option_text="Backlog items",
                is_correct=False,
            ),
        ],
    ),
    # Excluded: approved but retired
    Question(
        id="v-1007",
        question_id="q-1007",
        question_text="How long is a Sprint in the original Scrum guide?",
        question_type="multiple_choice",
        difficulty="hard",
        review_status="approved",
        publication_status="retired",
        is_flagged=False,
        options=[
            QuestionOption(
                position=1,
                option_text="30 days",
                is_correct=True,
            ),
            QuestionOption(
                position=2,
                option_text="14 days",
                is_correct=False,
            ),
        ],
    ),
    # Excluded: still pending review
    Question(
        id="v-1008",
        question_id="q-1008",
        question_text="Who owns the Product Backlog?",
        question_type="short_answer",
        difficulty="easy",
        review_status="pending",
        publication_status="active",
        is_flagged=False,
        expected_answer="Product Owner",
    ),
    # Excluded: rejected during review
    Question(
        id="v-1009",
        question_id="q-1009",
        question_text="Which of these is not a Scrum value?",
        question_type="multiple_choice",
        difficulty="medium",
        review_status="rejected",
        publication_status="active",
        is_flagged=False,
        options=[
            QuestionOption(
                position=1,
                option_text="Synergy",
                is_correct=True,
            ),
            QuestionOption(
                position=2,
                option_text="Focus",
                is_correct=False,
            ),
        ],
    ),
    # Excluded: approved, active, but flagged
    Question(
        id="v-1010",
        question_id="q-1010",
        question_text="What is the recommended Sprint length?",
        question_type="multiple_choice",
        difficulty="medium",
        review_status="approved",
        publication_status="active",
        is_flagged=True,
        options=[
            QuestionOption(
                position=1,
                option_text="One month or less",
                is_correct=True,
            ),
            QuestionOption(
                position=2,
                option_text="Exactly two weeks",
                is_correct=False,
            ),
        ],
    ),
]


class InMemoryQuestionRepository:
    """Deliver questions from a fixed in-memory list.

    Satisfies ``QuestionRepository`` structurally: it exposes a matching
    ``list_eligible`` method without inheriting from the protocol.
    """

    def __init__(self, questions: list[Question] | None = None) -> None:
        self._questions = _QUESTION_BANK if questions is None else questions

    def list_eligible(self) -> list[Question]:
        return [q for q in self._questions if _is_eligible(q)]


def _is_eligible(question: Question) -> bool:
    """The single predicate behind the exam-delivery acceptance criteria."""
    return (
        question.review_status == "approved"
        and question.publication_status == "active"
        and not question.is_flagged
    )
