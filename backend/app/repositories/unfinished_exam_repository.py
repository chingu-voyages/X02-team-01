"""List only the authenticated learner's unfinished, pinned attempts."""

from uuid import UUID

from sqlalchemy import func
from sqlmodel import Session, select

from app.models import Category, Certification, ExamAttempt, ExamResponse, PracticeExam
from app.schemas.unfinished_exam import UnfinishedExamOut


def list_unfinished_exams(
    session: Session, learner_id: UUID
) -> list[UnfinishedExamOut]:
    # A correlated count uses the existing attempt_id index. Drafts and
    # flags are intentionally NOT counted as submitted answers. No question
    # content is selected. One query, not one per attempt.
    submitted = (
        select(func.count(ExamResponse.id))
        .where(
            ExamResponse.attempt_id == ExamAttempt.id,
            ExamResponse.is_submitted.is_(True),
        )
        .correlate(ExamAttempt)
        .scalar_subquery()
    )
    rows = session.exec(
        select(
            ExamAttempt.id,
            ExamAttempt.practice_exam_id,
            Certification.name.label("certification_name"),
            Category.name.label("category_name"),
            PracticeExam.name.label("exam_name"),
            ExamAttempt.question_count,
            submitted.label("submitted_count"),
            ExamAttempt.current_position,
            ExamAttempt.started_at,
        )
        .select_from(ExamAttempt)
        .join(Certification, Certification.id == ExamAttempt.certification_id)
        .outerjoin(PracticeExam, PracticeExam.id == ExamAttempt.practice_exam_id)
        .outerjoin(Category, Category.id == PracticeExam.category_id)
        .where(
            ExamAttempt.user_id == learner_id,
            ExamAttempt.status == "in_progress",
        )
        .order_by(ExamAttempt.started_at.desc(), ExamAttempt.id)
    ).all()
    # Do not filter on catalog publication or current configured count.
    # The learner may resume their existing pinned exam even if it is no
    # longer startable. NULL practice_exam_id stays NULL for legacy attempts.
    return [
        UnfinishedExamOut(
            attempt_id=row.id,
            practice_exam_id=row.practice_exam_id,
            certification_name=row.certification_name,
            category_name=row.category_name,
            name=row.exam_name,
            question_count=row.question_count,
            submitted_count=row.submitted_count,
            current_position=row.current_position,
            started_at=row.started_at,
        )
        for row in rows
    ]
