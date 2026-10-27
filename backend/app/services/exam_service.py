"""Generate and persist a randomized practice exam attempt (JHEP-29).

The service owns the database transaction. Supply a dedicated request-scoped
Session: a successful call commits, and a failed call rolls back.
"""

from dataclasses import dataclass
from uuid import UUID

from sqlmodel import Session

from app.models import Certification, ExamAttempt, ExamAttemptQuestion, User
from app.repositories.question_repository import ExamQuestionSelector
from app.repositories.sqlmodel_repository import SQLModelQuestionRepository


@dataclass(frozen=True)
class CreatedExam:
    """Safe, minimal details of a successfully created attempt."""

    attempt_id: UUID
    certification_id: UUID
    question_count: int


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
