from app.repositories.question_repository import (
    Question,
    QuestionOption,
    QuestionRepository,
)
from app.schemas.question import (
    QuestionList,
    QuestionOptionOut,
    QuestionOut,
)


def get_eligible_questions(repo: QuestionRepository) -> QuestionList:
    """Return every question currently eligible for exam delivery.

    Eligibility is decided by the repository, which owns the
    approved/active/unflagged filter for its own storage. This layer only
    maps the domain objects onto the learner-facing response contract.
    """
    items = [_to_out(question) for question in repo.list_eligible()]

    return QuestionList(items=items, count=len(items))


def _to_out(question: Question) -> QuestionOut:
    """Map a domain question onto the pre-submission response model.

    Only fields declared on ``QuestionOut`` survive; the answer key
    (``expected_answer``) and any review/publication metadata are dropped
    structurally rather than by hand.
    """
    return QuestionOut(
        id=question.id,
        question_text=question.question_text,
        question_type=question.question_type,
        difficulty=question.difficulty,
        options=[_option_to_out(option) for option in question.options],
    )


def _option_to_out(option: QuestionOption) -> QuestionOptionOut:
    """Expose an option's display data, never ``is_correct``."""
    return QuestionOptionOut(
        position=option.position,
        option_text=option.option_text,
    )
