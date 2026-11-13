"""Administrative category management services."""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func
from sqlmodel import Session, select

from app.models.category import Category
from app.models.certification import Certification
from app.schemas.admin_category import CategoryCreate


class CategoryNameConflictError(ValueError):
    """A category already uses the requested name in this certification."""


class AdminCategoryNotFoundError(LookupError):
    """The requested category does not exist."""


class CategoryCertificationNotFoundError(LookupError):
    """The requested parent certification does not exist."""


@dataclass(frozen=True)
class AdminCategoryRecord:
    """Administrative category metadata."""

    id: UUID
    certification_id: UUID
    certification_name: str
    name: str
    is_published: bool


def list_categories(
    session: Session,
    *,
    certification_id: UUID | None = None,
) -> list[AdminCategoryRecord]:
    """Return published and unpublished categories for management."""
    statement = (
        select(
            Category,
            Certification.name,
        )
        .join(
            Certification,
            Certification.id == Category.certification_id,
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

    rows = session.exec(statement).all()

    return [
        AdminCategoryRecord(
            id=category.id,
            certification_id=(category.certification_id),
            certification_name=(certification_name),
            name=category.name,
            is_published=(category.is_published),
        )
        for category, certification_name in rows
    ]


def create_category(
    session: Session,
    payload: CategoryCreate,
) -> AdminCategoryRecord:
    """Create an unpublished category under an existing certification."""
    certification = session.get(
        Certification,
        payload.certification_id,
    )

    if certification is None:
        raise (CategoryCertificationNotFoundError("Certification not found"))

    existing = session.exec(
        select(Category).where(
            Category.certification_id == payload.certification_id,
            func.lower(Category.name) == payload.name.lower(),
        )
    ).first()

    if existing is not None:
        raise CategoryNameConflictError(
            "A category with this name already exists for this certification"
        )

    category = Category(
        certification_id=(payload.certification_id),
        name=payload.name,
        is_published=False,
    )

    try:
        session.add(category)
        session.commit()
        session.refresh(category)
    except Exception:
        session.rollback()
        raise

    return AdminCategoryRecord(
        id=category.id,
        certification_id=(category.certification_id),
        certification_name=(certification.name),
        name=category.name,
        is_published=(category.is_published),
    )


def set_category_publication(
    session: Session,
    category_id: UUID,
    *,
    is_published: bool,
) -> AdminCategoryRecord:
    """Publish or unpublish a category."""
    category = session.get(
        Category,
        category_id,
    )

    if category is None:
        raise AdminCategoryNotFoundError("Category not found")

    certification = session.get(
        Certification,
        category.certification_id,
    )

    if certification is None:
        raise (CategoryCertificationNotFoundError("Certification not found"))

    try:
        category.is_published = is_published

        session.add(category)
        session.commit()
        session.refresh(category)
    except Exception:
        session.rollback()
        raise

    return AdminCategoryRecord(
        id=category.id,
        certification_id=(category.certification_id),
        certification_name=(certification.name),
        name=category.name,
        is_published=(category.is_published),
    )
