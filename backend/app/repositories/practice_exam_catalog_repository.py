"""Learner-visible published practice exams backed by live question eligibility.

A published flag alone does not imply an exam is currently startable: parents
must still be published and sufficient active, approved questions must remain.
"""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import and_, func
from sqlmodel import Session, select

from app.core.config import settings
from app.models import Category, Certification, PracticeExam
from app.repositories.question_eligibility import eligible_exam_questions_statement


@dataclass(frozen=True)
class AvailablePracticeExam:
    id: UUID
    certification_id: UUID
    certification_name: str
    category_id: UUID
    category_name: str
    name: str
    question_count: int
    available_question_count: int


class SQLModelPracticeExamCatalogRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def list_available(self) -> list[AvailablePracticeExam]:
        """List only exams that can currently produce a complete new attempt."""
        eligible = eligible_exam_questions_statement().subquery()
        counts = (
            select(
                eligible.c.certification_id.label("certification_id"),
                eligible.c.category_id.label("category_id"),
                func.count(eligible.c.question_id.distinct()).label("available"),
            )
            .where(eligible.c.category_id.is_not(None))
            .group_by(eligible.c.certification_id, eligible.c.category_id)
            .subquery()
        )

        rows = self._session.exec(
            select(
                PracticeExam.id,
                PracticeExam.certification_id,
                Certification.name.label("certification_name"),
                PracticeExam.category_id,
                Category.name.label("category_name"),
                PracticeExam.name,
                PracticeExam.question_count,
                counts.c.available,
            )
            .select_from(PracticeExam)
            .join(Certification, Certification.id == PracticeExam.certification_id)
            .join(
                Category,
                and_(
                    Category.id == PracticeExam.category_id,
                    Category.certification_id == PracticeExam.certification_id,
                ),
            )
            .join(
                counts,
                and_(
                    counts.c.certification_id == PracticeExam.certification_id,
                    counts.c.category_id == PracticeExam.category_id,
                ),
            )
            .where(
                PracticeExam.status == "published",
                PracticeExam.question_count.is_not(None),
                PracticeExam.question_count >= 1,
                PracticeExam.question_count <= settings.max_exam_questions,
                Certification.is_published.is_(True),
                Category.is_published.is_(True),
                Certification.passing_threshold_pct.is_not(None),
                counts.c.available >= PracticeExam.question_count,
            )
            .order_by(
                func.lower(Certification.name),
                func.lower(Category.name),
                func.lower(PracticeExam.name),
                PracticeExam.id,
            )
        ).all()

        return [
            AvailablePracticeExam(
                id=row.id,
                certification_id=row.certification_id,
                certification_name=row.certification_name,
                category_id=row.category_id,
                category_name=row.category_name,
                name=row.name,
                question_count=row.question_count,
                available_question_count=row.available,
            )
            for row in rows
        ]
