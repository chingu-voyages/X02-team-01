"""Administrator dashboard overview KPIs (JHEP-115).

One read-only aggregate endpoint for the four KPI cards, the
Requires Attention panel and the Completed-Attempts-by-Exam table.

- Registered Learners (AC2): all-time current count of accounts whose
  role is Learner or Contributor — includes unverified and inactive
  accounts; administrators are excluded.
- Completed Attempts / Participating Learners (AC3/AC4): the
  period/exam-filtered set of finalized attempts (`status='submitted'`,
  window on `submitted_at` in UTC, inclusive). Every retake is its own
  attempt row; duplicate final submissions never rewrote one, so no
  de-duplication is needed.
- Pending Question Reviews (AC5): a current snapshot of distinct
  questions whose latest version is `submitted` or `in_review`
  (JHEP-119 lifecycle), with a breakdown that sums to the total.
- Attempts table (AC6): finalized attempts grouped by exam, highest
  count first; the rows sum to Completed Attempts under the same
  filters. Attempts without an exam id (JHEP-203 legacy rows) group
  under a labelled row.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from typing import Literal
from uuid import UUID

from sqlalchemy import func
from sqlmodel import Session, select

from app.core.roles import UserRole
from app.models.exam_attempt import ExamAttempt
from app.models.practice_exam import PracticeExam
from app.models.question_version import QuestionVersion
from app.models.user import User


class DashboardPeriodError(ValueError):
    """The requested reporting period/date range is invalid."""


Period = Literal["7", "30", "90", "all"]


@dataclass(frozen=True)
class DashboardOverview:
    registered_learners: int

    completed_attempts: int
    participating_learners: int

    pending_question_reviews: int
    review_breakdown_submitted: int
    review_breakdown_in_review: int

    attempts_by_exam: list[dict]

    filters: dict


LEGACY_EXAM_ROW_TITLE = "Legacy (earlier exams)"


def _window(period: str, from_date: str | None, to_date: str | None) -> tuple:
    """Resolve the inclusive UTC final-submission window (AC7)."""
    now = datetime.now(UTC)

    if period == "all" and from_date is None and to_date is None:
        return (None, None)

    if period == "custom":
        try:
            start = datetime.combine(
                datetime.strptime(from_date, "%Y-%m-%d"), time.min, tzinfo=UTC
            )
            end = datetime.combine(
                datetime.strptime(to_date, "%Y-%m-%d"), time.max, tzinfo=UTC
            )
        except (TypeError, ValueError) as exc:
            raise DashboardPeriodError(
                "Custom dates require ISO dates as YYYY-MM-DD"
            ) from exc

        if end < start:
            raise DashboardPeriodError("The end date must not be before the start date")

        return (start, end)

    if period not in ("7", "30", "90"):
        raise DashboardPeriodError("period must be 7, 30, 90, all or custom")

    start = datetime.combine(
        (now - timedelta(days=int(period) - 1)).date(), time.min, tzinfo=UTC
    )
    return (start, None)


def _completed_attempt_rows(
    session: Session,
    window: tuple,
    exam_id: UUID | None,
) -> list[ExamAttempt]:
    statement = select(ExamAttempt).where(ExamAttempt.status == "submitted")

    start, end = window
    if start is not None:
        statement = statement.where(ExamAttempt.submitted_at >= start)
    if end is not None:
        statement = statement.where(ExamAttempt.submitted_at <= end)
    if exam_id is not None:
        statement = statement.where(ExamAttempt.practice_exam_id == exam_id)

    return list(session.exec(statement))


def _pending_question_reviews(
    session: Session,
) -> tuple[int, int, int]:
    """AC5: distinct questions whose latest version is submitted/in_review.

    Same latest-version pattern as the question bank query service; the
    breakdown always sums to the total.
    """
    latest_number = (
        select(
            QuestionVersion.question_id.label("question_id"),
            func.max(QuestionVersion.version_number).label("max_version"),
        )
        .group_by(QuestionVersion.question_id)
        .subquery()
    )

    rows = session.exec(
        select(QuestionVersion)
        .join(
            latest_number,
            latest_number.c.question_id == QuestionVersion.question_id,
        )
        .where(
            QuestionVersion.version_number == latest_number.c.max_version,
            QuestionVersion.review_status.in_(["submitted", "in_review"]),
        )
    ).all()

    submitted = sum(1 for row in rows if row.review_status == "submitted")
    in_review = sum(1 for row in rows if row.review_status == "in_review")

    return len(rows), submitted, in_review


def _attempts_by_exam(
    session: Session,
    rows: list[ExamAttempt],
) -> list[dict]:
    counts: dict[UUID | None, int] = {}

    for row in rows:
        counts[row.practice_exam_id] = counts.get(row.practice_exam_id, 0) + 1

    titles: dict[UUID, str] = {}
    exam_ids = [exam_id for exam_id in counts if exam_id is not None]
    if exam_ids:
        exams = session.exec(
            select(PracticeExam).where(PracticeExam.id.in_(exam_ids))
        ).all()
        titles = {exam.id: exam.name for exam in exams}

    table = [
        {
            "exam_id": str(exam_id),
            "title": titles.get(exam_id, "Unavailable"),
            "count": count,
        }
        for exam_id, count in counts.items()
        if exam_id is not None
    ]

    legacy = counts.get(None, 0)
    if legacy > 0:
        table.append(
            {
                "exam_id": None,
                "title": LEGACY_EXAM_ROW_TITLE,
                "count": legacy,
            }
        )

    table.sort(key=lambda item: item["count"], reverse=True)
    return table


def dashboard_overview(
    session: Session,
    *,
    period: str = "30",
    from_date: str | None = None,
    to_date: str | None = None,
    exam_id: UUID | None = None,
) -> DashboardOverview:
    """Assemble the whole overview in one read-only pass."""
    window = _window(period, from_date, to_date)
    rows = _completed_attempt_rows(session, window, exam_id)

    registered_learners = session.exec(
        select(func.count(User.id)).where(
            User.role.in_([UserRole.LEARNER.value, UserRole.CONTRIBUTOR.value])
        )
    ).one()

    total_reviews, breakdown_submitted, breakdown_in_review = _pending_question_reviews(
        session
    )

    return DashboardOverview(
        registered_learners=registered_learners,
        completed_attempts=len(rows),
        participating_learners=len({row.user_id for row in rows}),
        pending_question_reviews=total_reviews,
        review_breakdown_submitted=breakdown_submitted,
        review_breakdown_in_review=breakdown_in_review,
        attempts_by_exam=_attempts_by_exam(session, rows),
        filters={
            "period": period,
            "from": from_date,
            "to": to_date,
            "exam_id": str(exam_id) if exam_id else None,
        },
    )
