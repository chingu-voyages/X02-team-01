"""Scalable read queries for the administrative question bank."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    and_,
    exists,
    func,
    or_,
)
from sqlmodel import Session, select

from app.core.roles import UserRole
from app.models.category import Category
from app.models.certification import Certification
from app.models.question import Question
from app.models.question_image import QuestionImage
from app.models.question_version import QuestionVersion
from app.models.user import User


@dataclass(frozen=True)
class QuestionBankQueryRecord:
    """One latest-version row returned by the management question bank."""

    question_id: UUID
    question_version_id: UUID
    version_number: int
    question_preview: str

    certification_id: UUID
    certification_name: str

    category_id: UUID | None
    category_name: str | None

    difficulty: str
    question_type: str

    review_status: str
    publication_status: str

    is_flagged: bool
    has_image: bool

    created_by_id: UUID
    last_updated: datetime


@dataclass(frozen=True)
class QuestionBankQueryResult:
    """Filtered question-bank page plus total matching record count."""

    items: list[QuestionBankQueryRecord]
    total: int


def query_question_bank(
    session: Session,
    *,
    actor: User,
    search: str | None = None,
    certification_id: UUID | None = None,
    category_id: UUID | None = None,
    difficulty: str | None = None,
    question_type: str | None = None,
    review_status: str | None = None,
    publication_status: str | None = None,
    has_image: bool | None = None,
    page: int = 1,
    page_size: int | None = None,
) -> QuestionBankQueryResult:
    """Search/filter the latest question version without loading the full bank."""

    if actor.role not in {
        UserRole.CONTRIBUTOR,
        UserRole.ADMINISTRATOR,
    }:
        return QuestionBankQueryResult(
            items=[],
            total=0,
        )

    latest_versions = (
        select(
            QuestionVersion.question_id.label("question_id"),
            func.max(QuestionVersion.version_number).label("version_number"),
        )
        .group_by(QuestionVersion.question_id)
        .subquery()
    )

    image_exists = exists(
        select(QuestionImage.id).where(
            QuestionImage.question_version_id == QuestionVersion.id
        )
    )

    statement = (
        select(
            Question,
            QuestionVersion,
            Certification,
            Category,
            image_exists.label("has_image"),
        )
        .join(
            latest_versions,
            latest_versions.c.question_id == Question.id,
        )
        .join(
            QuestionVersion,
            and_(
                QuestionVersion.question_id == Question.id,
                QuestionVersion.version_number == latest_versions.c.version_number,
            ),
        )
        .join(
            Certification,
            Certification.id == Question.certification_id,
        )
        .outerjoin(
            Category,
            Category.id == Question.category_id,
        )
    )

    if actor.role == UserRole.CONTRIBUTOR:
        statement = statement.where(Question.created_by_id == actor.id)

    normalized_search = search.strip() if search else ""

    if normalized_search:
        pattern = f"%{normalized_search}%"

        search_conditions = [
            QuestionVersion.question_text.ilike(pattern),
            Certification.name.ilike(pattern),
            Certification.code.ilike(pattern),
            Category.name.ilike(pattern),
        ]

        try:
            searched_question_id = UUID(normalized_search)
        except ValueError:
            searched_question_id = None

        if searched_question_id is not None:
            search_conditions.append(Question.id == searched_question_id)

        statement = statement.where(or_(*search_conditions))

    if certification_id is not None:
        statement = statement.where(Question.certification_id == certification_id)

    if category_id is not None:
        statement = statement.where(Question.category_id == category_id)

    if difficulty is not None:
        statement = statement.where(Question.difficulty == difficulty)

    if question_type is not None:
        statement = statement.where(QuestionVersion.question_type == question_type)

    if review_status is not None:
        statement = statement.where(QuestionVersion.review_status == review_status)

    if publication_status is not None:
        statement = statement.where(
            QuestionVersion.publication_status == publication_status
        )

    if has_image is True:
        statement = statement.where(image_exists)

    elif has_image is False:
        statement = statement.where(~image_exists)

    count_statement = select(func.count()).select_from(statement.subquery())

    total = int(session.exec(count_statement).one())

    statement = statement.order_by(
        QuestionVersion.submitted_at.desc(),
        Question.id,
    )

    if page_size is not None:
        statement = statement.offset((page - 1) * page_size).limit(page_size)

    rows = session.exec(statement).all()

    items = [
        QuestionBankQueryRecord(
            question_id=question.id,
            question_version_id=version.id,
            version_number=(version.version_number),
            question_preview=_preview(version.question_text),
            certification_id=(question.certification_id),
            certification_name=(certification.name),
            category_id=(question.category_id),
            category_name=(category.name if category is not None else None),
            difficulty=(question.difficulty),
            question_type=(version.question_type),
            review_status=(version.review_status),
            publication_status=(version.publication_status),
            is_flagged=(version.is_flagged),
            has_image=bool(row_has_image),
            created_by_id=(question.created_by_id),
            last_updated=(version.submitted_at),
        )
        for (
            question,
            version,
            certification,
            category,
            row_has_image,
        ) in rows
    ]

    return QuestionBankQueryResult(
        items=items,
        total=total,
    )


def _preview(
    question_text: str,
    limit: int = 160,
) -> str:
    """Keep list previews consistent with the existing question service."""

    if len(question_text) <= limit:
        return question_text

    return f"{question_text[: limit - 3]}..."
