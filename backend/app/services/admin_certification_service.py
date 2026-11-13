"""Administrative certification management services."""

from sqlmodel import Session, select

from app.models.certification import Certification
from app.schemas.admin_certification import CertificationCreate


class CertificationCodeConflictError(ValueError):
    """A certification already uses the requested code."""


def list_certifications(
    session: Session,
) -> list[Certification]:
    """Return certifications ordered for management display."""
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
    """Create a certification with server-validated configuration."""
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
        feedback_mode=payload.feedback_mode,
    )

    try:
        session.add(certification)
        session.commit()
        session.refresh(certification)
    except Exception:
        session.rollback()
        raise

    return certification
