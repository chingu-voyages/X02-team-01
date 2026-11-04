"""One exam-eligibility query for randomized selection and catalog counts."""

from sqlalchemy import and_, case, func, or_
from sqlalchemy.sql import Select
from sqlmodel import select

from app.models import AnswerOption, Question, QuestionVersion


def eligible_exam_questions_statement() -> Select:
    """Return eligible question/version IDs and their certification/category.

    Preserve the existing exam selector's rules. In particular, short-answer
    questions remain eligible without checking TextAnswerKey; this is a
    refactor, not a change to short-answer grading policy.

    There is no random ordering or limit here. Callers add those as needed.
    Answer-key values never appear in the selected result columns.
    PostgreSQL's active-version unique index permits one active version per
    parent question.
    """
    option_counts = (
        select(
            AnswerOption.question_version_id.label("version_id"),
            func.count(AnswerOption.id).label("option_count"),
            func.sum(case((AnswerOption.is_correct.is_(True), 1), else_=0)).label(
                "correct_count"
            ),
        )
        .group_by(AnswerOption.question_version_id)
        .subquery()
    )

    return (
        select(
            Question.id.label("question_id"),
            QuestionVersion.id.label("question_version_id"),
            Question.certification_id.label("certification_id"),
            Question.category_id.label("category_id"),
        )
        .select_from(Question)
        .join(QuestionVersion, QuestionVersion.question_id == Question.id)
        .outerjoin(option_counts, option_counts.c.version_id == QuestionVersion.id)
        .where(
            QuestionVersion.review_status == "approved",
            QuestionVersion.publication_status == "active",
            QuestionVersion.is_flagged.is_(False),
            or_(
                QuestionVersion.question_type == "short_answer",
                and_(
                    QuestionVersion.question_type == "multiple_choice",
                    option_counts.c.option_count >= 2,
                    option_counts.c.correct_count >= 1,
                    or_(
                        QuestionVersion.allows_multiple_answers.is_(True),
                        option_counts.c.correct_count == 1,
                    ),
                ),
            ),
        )
    )
