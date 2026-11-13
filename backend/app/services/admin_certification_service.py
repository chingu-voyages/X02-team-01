"""Administrative certification management services."""

from uuid import UUID

from sqlmodel import Session, select

from app.models.certification import Certification
from app.schemas.admin_certification import (
    CertificationCreate,
)


class CertificationCodeConflictError(ValueError):
    """A certification already uses the requested code."""


class CertificationNotFoundError(LookupError):
    """The requested certification does not exist."""


def list_certifications(
    session: Session,
) -> list[Certification]:
    """Return all certifications for administrative management."""
    return list(
        session.exec(
            select(Certification).order_by(
                Certification.name,
                Certification.code,
            )
        ).all()
    )


def create_certification(
    session: Session,
    payload: CertificationCreate,
) -> Certification:
    """Create an unpublished certification."""
    existing = session.exec(
        select(Certification).where(Certification.code == payload.code)
    ).first()

    if existing is not None:
        raise CertificationCodeConflictError(
            "A certification with this code already exists"
        )

    certification = Certification(
        name=payload.name,
        code=payload.code,
        passing_threshold_pct=(payload.passing_threshold_pct),
        feedback_mode=(payload.feedback_mode),
        is_published=False,
    )

    try:
        session.add(certification)
        session.commit()
        session.refresh(certification)
    except Exception:
        session.rollback()
        raise

    return certification


def set_certification_publication(
    session: Session,
    certification_id: UUID,
    *,
    is_published: bool,
) -> Certification:
    """Publish or unpublish a certification."""
    certification = session.get(
        Certification,
        certification_id,
    )

    if certification is None:
        raise CertificationNotFoundError("Certification not found")

    try:
        certification.is_published = is_published

        session.add(certification)
        session.commit()
        session.refresh(certification)
    except Exception:
        session.rollback()
        raise

    return certification
