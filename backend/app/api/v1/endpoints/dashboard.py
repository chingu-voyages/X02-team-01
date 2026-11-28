"""Administrator dashboard overview (JHEP-115).

AC1: every route below is Administrator-only; non-admins receive 403
and anonymous requests 401, enforced by the shared role dependency.
"""

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session

from app.api.deps import require_administrator
from app.db.session import get_session
from app.models.user import User
from app.schemas.admin_dashboard import DashboardOverviewOut
from app.services.admin_dashboard_service import (
    DashboardPeriodError,
    dashboard_overview,
)

router = APIRouter(
    prefix="/admin/dashboard",
    dependencies=[Depends(require_administrator)],
)


@router.get("/overview", response_model=DashboardOverviewOut)
def dashboard_overview_endpoint(
    actor: Annotated[
        User,
        Depends(require_administrator),
    ],
    session: Annotated[Session, Depends(get_session)],
    period: str = Query(default="30"),
    from_date: str | None = Query(default=None, alias="from"),
    to_date: str | None = Query(default=None, alias="to"),
    exam_id: Annotated[UUID | None, Query()] = None,
) -> DashboardOverviewOut:
    """The four KPI cards, attention panel and attempts table in one call."""
    try:
        overview = dashboard_overview(
            session,
            period=period,
            from_date=from_date,
            to_date=to_date,
            exam_id=exam_id,
        )
    except DashboardPeriodError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": "INVALID_PERIOD", "message": str(exc)},
        ) from exc

    return DashboardOverviewOut(
        registered_learners=overview.registered_learners,
        completed_attempts=overview.completed_attempts,
        participating_learners=overview.participating_learners,
        pending_question_reviews=overview.pending_question_reviews,
        review_breakdown={
            "submitted": overview.review_breakdown_submitted,
            "in_review": overview.review_breakdown_in_review,
        },
        attempts_by_exam=overview.attempts_by_exam,
        filters=overview.filters,
        generated_at=datetime.now(UTC),
    )
