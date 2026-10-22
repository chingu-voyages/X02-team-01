from collections import defaultdict
from uuid import UUID

from sqlmodel import Session, select

from app.models import (
    AnswerOption,
    QuestionVersion,
    TextAnswerKey,
)
from app.models import (
    Question as QuestionModel,
)
from app.repositories.question_repository import Question, QuestionOption


class SQLModelQuestionRepository:
    """Deliver question versions from the PostgreSQL question bank.

    Only versions that are approved, active and unflagged are returned. The
    repository owns the storage-specific filter and maps rows onto the plain
    domain objects consumed by the service layer.
    """

    def __init__(self, session: Session) -> None:
        self._session = session

    def list_eligible(self) -> list[Question]:
        versions = self._session.exec(
            select(QuestionVersion)
            .where(
                QuestionVersion.review_status == "approved",
                QuestionVersion.publication_status == "active",
                QuestionVersion.is_flagged.is_(False),
            )
            .order_by(QuestionVersion.question_id, QuestionVersion.version_number)
        ).all()

        if not versions:
            return []

        version_ids = [version.id for version in versions]
        question_ids = {version.question_id for version in versions}

        questions = {
            question.id: question
            for question in self._session.exec(
                select(QuestionModel).where(QuestionModel.id.in_(question_ids))
            ).all()
        }

        options: dict[UUID, list[QuestionOption]] = defaultdict(list)
        for option in self._session.exec(
            select(AnswerOption)
            .where(AnswerOption.question_version_id.in_(version_ids))
            .order_by(AnswerOption.question_version_id, AnswerOption.position)
        ).all():
            options[option.question_version_id].append(
                QuestionOption(
                    position=option.position,
                    option_text=option.option_text,
                    is_correct=option.is_correct,
                )
            )

        expected_answers = {
            key.question_version_id: key.expected_answer
            for key in self._session.exec(
                select(TextAnswerKey).where(
                    TextAnswerKey.question_version_id.in_(version_ids)
                )
            ).all()
        }

        return [
            Question(
                id=str(version.id),
                question_id=str(version.question_id),
                question_text=version.question_text,
                question_type=version.question_type,
                difficulty=questions[version.question_id].difficulty,
                review_status=version.review_status,
                publication_status=version.publication_status,
                is_flagged=version.is_flagged,
                allows_multiple_answers=version.allows_multiple_answers,
                options=options[version.id],
                expected_answer=expected_answers.get(version.id),
            )
            for version in versions
        ]
