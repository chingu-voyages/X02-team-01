"""One exam-eligibility query for randomized selection and catalog counts."""

from sqlalchemy import (
    and_,
    case,
    func,
    or_,
)
from sqlalchemy.sql import Select
from sqlmodel import select

from app.models import (
    AnswerOption,
    Certification,
    Question,
    QuestionVersion,
)


def eligible_exam_questions_statement() -> Select:
    """Return learner-eligible question/version IDs.

    Eligibility requires:
    - the parent certification is published;
    - the question version is approved and active;
    - the version is not flagged;
    - multiple-choice answer configuration is valid.

    Category publication is validated separately when a learner
    selects a category. Certification publication belongs here
    because certification-wide selection must not bypass it.
    """
    option_counts = (
        select(
            AnswerOption.question_version_id.label("version_id"),
            func.count(AnswerOption.id).label("option_count"),
            func.sum(
                case(
                    (
                        AnswerOption.is_correct.is_(True),
                        1,
                    ),
                    else_=0,
                )
            ).label("correct_count"),
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
        .join(
            Certification,
            Certification.id == Question.certification_id,
        )
        .join(
            QuestionVersion,
            QuestionVersion.question_id == Question.id,
        )
        .outerjoin(
            option_counts,
            option_counts.c.version_id == QuestionVersion.id,
        )
        .where(
            Certification.is_published.is_(True),
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
