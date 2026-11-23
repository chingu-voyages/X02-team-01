"""Admin-only exam catalog and atomic publication rules (JHEP-126).

Publication state belongs to a configured PracticeExam, not to the parent
Certification, Category, or individual Question. Existing attempts are untouched.
"""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.core.config import settings
from app.models import Category, Certification, PracticeExam
from app.repositories.question_eligibility import eligible_exam_questions_statement
from app.schemas.admin_practice_exam import PracticeExamCreate


class PracticeExamNotFoundError(LookupError):
    """Unknown practice-exam ID."""


class PracticeExamScopeError(ValueError):
    """The selected certification/category combination does not exist."""


class PracticeExamNameConflictError(ValueError):
    """An exam with this name already exists in the category."""


class PracticeExamNotReadyError(ValueError):
    """Publishing was rejected without changing database state."""

    def __init__(self, readiness: "ExamReadiness") -> None:
        self.readiness = readiness
        super().__init__("Practice exam is not ready to publish")


@dataclass(frozen=True)
class ReadinessIssue:
    code: str
    message: str


@dataclass(frozen=True)
class ExamReadiness:
    ready: bool
    required_question_count: int | None
    eligible_question_count: int
    issues: list[ReadinessIssue]


@dataclass(frozen=True)
class PracticeExamDetails:
    id: UUID
    certification_id: UUID
    certification_name: str
    category_id: UUID
    category_name: str
    name: str
    question_count: int | None
    status: str
    readiness: ExamReadiness


def _eligible_question_count(session: Session, exam: PracticeExam) -> int:
    """Use the *same* eligibility query as randomized exam selection."""
    eligible = eligible_exam_questions_statement().subquery()
    count = session.exec(
        select(func.count(eligible.c.question_id.distinct())).where(
            eligible.c.certification_id == exam.certification_id,
            eligible.c.category_id == exam.category_id,
        )
    ).one()
    return int(count)


def _readiness(
    session: Session,
    exam: PracticeExam,
    certification: Certification,
    category: Category,
) -> ExamReadiness:
    issues: list[ReadinessIssue] = []
    count = exam.question_count

    if not certification.is_published:
        issues.append(
            ReadinessIssue(
                "CERTIFICATION_UNPUBLISHED",
                "Publish the parent certification first.",
            )
        )
    if not category.is_published:
        issues.append(
            ReadinessIssue(
                "CATEGORY_UNPUBLISHED",
                "Publish the parent category first.",
            )
        )
    if (
        certification.passing_threshold_pct is None
        or not 0 <= certification.passing_threshold_pct <= 100
    ):
        issues.append(
            ReadinessIssue(
                "PASSING_THRESHOLD_MISSING",
                "Configure a passing threshold between 0 and 100%.",
            )
        )
    if count is None:
        issues.append(
            ReadinessIssue(
                "QUESTION_COUNT_MISSING",
                "Configure the exam question count before publishing (JHEP-107).",
            )
        )
    elif not 1 <= count <= min(100, settings.max_exam_questions):
        issues.append(
            ReadinessIssue(
                "QUESTION_COUNT_INVALID",
                "Set a question count within the configured 1–100 limit.",
            )
        )

    available = _eligible_question_count(session, exam)
    if count is not None and available < count:
        issues.append(
            ReadinessIssue(
                "INSUFFICIENT_PUBLISHED_QUESTIONS",
                (
                    f"Need {count} eligible published questions; "
                    f"only {available} available."
                ),
            )
        )

    return ExamReadiness(
        ready=not issues,
        required_question_count=count,
        eligible_question_count=available,
        issues=issues,
    )


def _details(
    session: Session,
    exam: PracticeExam,
    certification: Certification,
    category: Category,
) -> PracticeExamDetails:
    return PracticeExamDetails(
        id=exam.id,
        certification_id=exam.certification_id,
        certification_name=certification.name,
        category_id=exam.category_id,
        category_name=category.name,
        name=exam.name,
        question_count=exam.question_count,
        status=exam.status,
        readiness=_readiness(session, exam, certification, category),
    )


def _scope(session: Session, exam: PracticeExam) -> tuple[Certification, Category]:
    certification = session.get(Certification, exam.certification_id)
    category = session.get(Category, exam.category_id)
    if (
        certification is None
        or category is None
        or category.certification_id != exam.certification_id
    ):
        raise PracticeExamScopeError("Exam certification/category is invalid")
    return certification, category


def list_practice_exams(session: Session) -> list[PracticeExamDetails]:
    exams = session.exec(
        select(PracticeExam).order_by(PracticeExam.name, PracticeExam.id)
    ).all()
    return [_details(session, exam, *_scope(session, exam)) for exam in exams]


def get_practice_exam(session: Session, exam_id: UUID) -> PracticeExamDetails:
    exam = session.get(PracticeExam, exam_id)
    if exam is None:
        raise PracticeExamNotFoundError("Practice exam not found")
    certification, category = _scope(session, exam)
    return _details(session, exam, certification, category)


def create_practice_exam(
    session: Session, payload: PracticeExamCreate
) -> PracticeExamDetails:
    certification = session.get(Certification, payload.certification_id)
    category = session.get(Category, payload.category_id)
    if certification is None or category is None:
        raise PracticeExamScopeError("Certification or category not found")
    if category.certification_id != certification.id:
        raise PracticeExamScopeError("Category does not belong to certification")

    existing = session.exec(
        select(PracticeExam.id).where(
            PracticeExam.category_id == payload.category_id,
            PracticeExam.name == payload.name,
        )
    ).first()
    if existing is not None:
        raise PracticeExamNameConflictError("Exam name already exists in category")

    exam = PracticeExam(
        certification_id=payload.certification_id,
        category_id=payload.category_id,
        name=payload.name,
        question_count=payload.question_count,
        status="draft",
    )
    try:
        session.add(exam)
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise PracticeExamNameConflictError(
            "Exam already exists or its catalog scope is invalid"
        ) from exc
    except Exception:
        session.rollback()
        raise
    session.refresh(exam)
    return _details(session, exam, certification, category)


def set_practice_exam_publication(
    session: Session, exam_id: UUID, *, is_published: bool
) -> PracticeExamDetails:
    """Serialize updates on the exam row; repeated operations are no-ops.

    FOR UPDATE locks the row on PostgreSQL (our deployment database), so
    concurrent publish/unpublish requests execute in a definite order.
    It is ignored by SQLite, which is used only by isolated unit tests.
    """
    try:
        exam = session.exec(
            select(PracticeExam).where(PracticeExam.id == exam_id).with_for_update()
        ).first()
        if exam is None:
            raise PracticeExamNotFoundError("Practice exam not found")

        certification, category = _scope(session, exam)
        desired_status = "published" if is_published else "unpublished"

        if exam.status == desired_status:
            # No duplicate write; release the database row lock promptly.
            snapshot = _details(session, exam, certification, category)
            session.rollback()
            return snapshot

        if is_published:
            readiness = _readiness(session, exam, certification, category)
            if not readiness.ready:
                raise PracticeExamNotReadyError(readiness)

        exam.status = desired_status
        session.add(exam)
        session.commit()
        session.refresh(exam)
        return _details(session, exam, certification, category)
    except Exception:
        # Explicit rollback also releases a SELECT FOR UPDATE lock on errors.
        session.rollback()
        raise
