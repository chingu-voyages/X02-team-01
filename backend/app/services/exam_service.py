"""Generate and persist a randomized practice exam attempt (JHEP-29).

The service owns the database transaction. Supply a dedicated request-scoped
Session: a successful call commits, and a failed call rolls back.
"""

from collections import defaultdict
from dataclasses import dataclass
from uuid import UUID

from sqlmodel import Session, select

from app.core.config import settings
from app.models import (
    AnswerOption,
    Certification,
    ExamAttempt,
    ExamAttemptQuestion,
    Question,
    QuestionVersion,
    User,
)
from app.repositories.question_repository import ExamQuestionSelector
from app.repositories.sqlmodel_repository import SQLModelQuestionRepository


@dataclass(frozen=True)
class CreatedExam:
    """Safe, minimal details of a successfully created attempt."""

    attempt_id: UUID
    certification_id: UUID
    question_count: int


@dataclass(frozen=True)
class ExamOptionContent:
    """Learner-visible answer option; deliberately excludes correctness."""

    id: UUID
    position: int
    option_text: str


@dataclass(frozen=True)
class ExamQuestionContent:
    """Stored exam assignment with safe question content."""

    id: UUID  # Question-version ID
    position: int
    question_text: str
    question_type: str
    allows_multiple_answers: bool
    difficulty: str
    options: list[ExamOptionContent]


class InvalidQuestionCountError(ValueError):
    """The requested count is not a positive integer."""


class LearnerNotFoundError(LookupError):
    """The authenticated learner has no matching users row."""


class CertificationNotFoundError(LookupError):
    """The requested certification does not exist."""


class InsufficientQuestionsError(Exception):
    """There are not enough eligible questions to generate a complete exam."""

    def __init__(self, requested: int, available: int) -> None:
        self.requested = requested
        self.available = available
        super().__init__(
            f"Requested {requested} questions, but only {available} are available"
        )


class InvalidQuestionSelectionError(RuntimeError):
    """The selector returned duplicate questions or an invalid result size."""


class ExamService:
    """Coordinate selection and atomic persistence of an exam attempt."""

    def __init__(
        self,
        session: Session,
        selector: ExamQuestionSelector | None = None,
    ) -> None:
        self._session = session
        self._selector = (
            selector if selector is not None else SQLModelQuestionRepository(session)
        )

    def create_exam(
        self,
        *,
        learner_id: UUID,
        certification_id: UUID,
        question_count: int,
    ) -> CreatedExam:
        """Create an attempt with exactly `question_count` distinct questions.

        Nothing is committed if validation, selection, or persistence fails.
        `learner_id` must come from verified authentication, never request JSON.
        """
        if (
            isinstance(question_count, bool)
            or not isinstance(question_count, int)
            or question_count < 1
        ):
            raise InvalidQuestionCountError("question_count must be a positive integer")
        if question_count > settings.max_exam_questions:
            raise InvalidQuestionCountError(
                f"question_count must not exceed {settings.max_exam_questions}"
            )

        try:
            if self._session.get(User, learner_id) is None:
                raise LearnerNotFoundError("Learner not found")

            if self._session.get(Certification, certification_id) is None:
                raise CertificationNotFoundError("Certification not found")

            selected = self._selector.select_random_eligible(
                certification_id=certification_id,
                question_count=question_count,
            )
            if len(selected) < question_count:
                raise InsufficientQuestionsError(
                    requested=question_count,
                    available=len(selected),
                )

            # The selector and the database should both guard against duplicates.
            question_ids = {item.question_id for item in selected}
            version_ids = {item.question_version_id for item in selected}
            if (
                len(selected) != question_count
                or len(question_ids) != question_count
                or len(version_ids) != question_count
            ):
                raise InvalidQuestionSelectionError(
                    "Question selection contains duplicates or an invalid size"
                )

            attempt = ExamAttempt(
                user_id=learner_id,
                certification_id=certification_id,
                question_count=question_count,
            )
            self._session.add(attempt)
            # Flush first: no ORM relationship is needed to force parent before child.
            self._session.flush()
            attempt_id = attempt.id

            self._session.add_all(
                [
                    ExamAttemptQuestion(
                        attempt_id=attempt_id,
                        question_id=item.question_id,
                        question_version_id=item.question_version_id,
                        position=position,
                    )
                    for position, item in enumerate(selected, start=1)
                ]
            )
            # A single commit persists the parent and every assignment atomically.
            self._session.commit()

        except Exception:
            self._session.rollback()
            raise

        return CreatedExam(
            attempt_id=attempt_id,
            certification_id=certification_id,
            question_count=question_count,
        )

    def get_exam_questions(self, attempt_id: UUID) -> list[ExamQuestionContent]:
        """Read assigned questions in fixed order, without loading answer keys.

        Only call after the learner has been authenticated and ownership checked.
        This milestone calls it exclusively for an exam that was just created
        by the same authenticated learner. A future GET-by-ID endpoint must
        perform its own owner check before using this method.
        """
        rows = self._session.exec(
            select(
                ExamAttemptQuestion.position,
                QuestionVersion.id,
                QuestionVersion.question_text,
                QuestionVersion.question_type,
                QuestionVersion.allows_multiple_answers,
                Question.difficulty,
            )
            .select_from(ExamAttemptQuestion)
            .join(
                QuestionVersion,
                ExamAttemptQuestion.question_version_id == QuestionVersion.id,
            )
            .join(Question, Question.id == QuestionVersion.question_id)
            .where(ExamAttemptQuestion.attempt_id == attempt_id)
            .order_by(ExamAttemptQuestion.position)
        ).all()

        if not rows:
            return []

        version_ids = [version_id for _, version_id, *_ in rows]
        option_rows = self._session.exec(
            select(
                AnswerOption.question_version_id,
                AnswerOption.id,
                AnswerOption.position,
                AnswerOption.option_text,
            )
            .where(AnswerOption.question_version_id.in_(version_ids))
            .order_by(AnswerOption.question_version_id, AnswerOption.position)
        ).all()

        options_by_version: dict[UUID, list[ExamOptionContent]] = defaultdict(list)
        for version_id, option_id, position, option_text in option_rows:
            options_by_version[version_id].append(
                ExamOptionContent(
                    id=option_id,
                    position=position,
                    option_text=option_text,
                )
            )

        return [
            ExamQuestionContent(
                id=version_id,
                position=position,
                question_text=question_text,
                question_type=question_type,
                allows_multiple_answers=allows_multiple_answers,
                difficulty=difficulty,
                options=options_by_version[version_id],
            )
            for (
                position,
                version_id,
                question_text,
                question_type,
                allows_multiple_answers,
                difficulty,
            ) in rows
        ]
