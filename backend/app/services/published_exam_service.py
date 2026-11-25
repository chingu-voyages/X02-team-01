"""Publication gate for all HTTP exam starts (JHEP-126).

The existing JHEP-29 ExamService still owns randomized selection, atomic
attempt creation, and existing-attempt lifecycle. This subclass is used by
FastAPI's get_exam_service factory, so every POST /exams must select an exam
that an administrator has published. A shared row lock remains held until the
base service commits, serializing starts with administrator unpublishing.
"""

from uuid import UUID

from sqlmodel import select

from app.models import Category, Certification, PracticeExam
from app.services.exam_service import CreatedExam, ExamService


class PracticeExamUnavailableError(ValueError):
    """No matching published exam is available to start."""


class PracticeExamQuestionCountMismatchError(ValueError):
    """A caller attempted to override a configured exam's fixed length."""

    def __init__(self, expected: int, received: int) -> None:
        self.expected = expected
        self.received = received
        super().__init__(f"This practice exam requires exactly {expected} questions")


class PublishedExamService(ExamService):
    def create_exam(
        self,
        *,
        learner_id: UUID,
        certification_id: UUID,
        question_count: int,
        category_id: UUID | None = None,
        practice_exam_id: UUID | None = None,
    ) -> CreatedExam:
        """Only start a matching published exam; do not accept learner count edits.

        API clients should pass practice_exam_id. Old clients may still supply
        the certification/category/count triple, but it must identify exactly
        one published exam. Ambiguous triples cannot safely identify an exam.
        """
        try:
            if category_id is None:
                raise PracticeExamUnavailableError(
                    "Select an available published practice exam first"
                )

            statement = select(PracticeExam).where(
                PracticeExam.certification_id == certification_id,
                PracticeExam.category_id == category_id,
                PracticeExam.status == "published",
            )
            if practice_exam_id is not None:
                statement = statement.where(PracticeExam.id == practice_exam_id)
            else:
                # A legacy caller may omit the ID only when its exact
                # configuration uniquely identifies a published practice exam.
                statement = statement.where(
                    PracticeExam.question_count == question_count
                )

            # PostgreSQL FOR SHARE conflicts with the admin service's FOR
            # UPDATE. SQLite ignores this lock; concurrency is tested on PG.
            matches = self._session.exec(
                statement.order_by(PracticeExam.id).limit(2).with_for_update(read=True)
            ).all()
            if len(matches) > 1:
                raise PracticeExamUnavailableError(
                    "Multiple published practice exams match; select a specific exam"
                )
            if not matches or matches[0].question_count is None:
                raise PracticeExamUnavailableError(
                    "This practice exam is unavailable for new attempts"
                )
            published = matches[0]

            if question_count != published.question_count:
                raise PracticeExamQuestionCountMismatchError(
                    expected=published.question_count, received=question_count
                )

            parent_certification = self._session.get(
                Certification, published.certification_id
            )
            parent_category = self._session.get(Category, published.category_id)
            if (
                parent_certification is None
                or not parent_certification.is_published
                or parent_category is None
                or not parent_category.is_published
                or parent_category.certification_id != published.certification_id
            ):
                raise PracticeExamUnavailableError(
                    "This practice exam is unavailable for new attempts"
                )

            # The base service rechecks the learner, the threshold, the
            # selected category, and the live eligible question pool, then
            # commits the attempt atomically. Its commit releases our lock.
            # Always pass the resolved ID, including for unique legacy starts.
            return super().create_exam(
                learner_id=learner_id,
                certification_id=certification_id,
                question_count=published.question_count,
                category_id=published.category_id,
                practice_exam_id=published.id,
            )
        except Exception:
            # In the base service errors roll back internally. For early
            # availability rejections, this releases any FOR SHARE lock.
            self._session.rollback()
            raise
