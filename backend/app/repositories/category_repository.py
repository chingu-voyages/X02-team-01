"""Read-only category availability backed by the shared exam question pool."""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import and_, func
from sqlmodel import Session, select

from app.models import (
    Category,
    Certification,
)
from app.repositories.question_eligibility import (
    eligible_exam_questions_statement,
)


@dataclass(frozen=True)
class AvailableCategory:
    """Public catalog metadata, without question content or answer keys."""

    id: UUID
    certification_id: UUID
    name: str
    certification_name: str
    available_question_count: int


class SQLModelCategoryRepository:
    """Retrieve published learner-visible categories."""

    def __init__(
        self,
        session: Session,
    ) -> None:
        self._session = session

    def list_available(
        self,
        *,
        certification_id: UUID | None = None,
    ) -> list[AvailableCategory]:
        """List categories that are currently available to learners."""
        eligible = eligible_exam_questions_statement().subquery()

        counts = (
            select(
                eligible.c.certification_id,
                eligible.c.category_id,
                func.count(eligible.c.question_id.distinct()).label(
                    "available_question_count"
                ),
            )
            .where(eligible.c.category_id.is_not(None))
            .group_by(
                eligible.c.certification_id,
                eligible.c.category_id,
            )
            .subquery()
        )

        statement = (
            select(
                Category.id.label("id"),
                Category.certification_id.label("certification_id"),
                Category.name.label("name"),
                Certification.name.label("certification_name"),
                counts.c.available_question_count,
            )
            .select_from(Category)
            .join(
                Certification,
                Certification.id == Category.certification_id,
            )
            .join(
                counts,
                and_(
                    counts.c.category_id == Category.id,
                    counts.c.certification_id == Category.certification_id,
                ),
            )
            .where(
                Certification.is_published.is_(True),
                Category.is_published.is_(True),
                Certification.passing_threshold_pct.is_not(None),
                counts.c.available_question_count > 0,
            )
            .order_by(
                func.lower(Certification.name),
                Certification.id,
                func.lower(Category.name),
                Category.id,
            )
        )

        if certification_id is not None:
            statement = statement.where(Category.certification_id == certification_id)

        with self._session.no_autoflush:
            rows = self._session.exec(statement).all()

        return [
            AvailableCategory(
                id=row.id,
                certification_id=(row.certification_id),
                name=row.name,
                certification_name=(row.certification_name),
                available_question_count=(row.available_question_count),
            )
            for row in rows
        ]
