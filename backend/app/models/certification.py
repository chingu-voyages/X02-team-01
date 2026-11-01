from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, text
from sqlmodel import Field, SQLModel

# Feedback modes configured by the exam admin. The mode is snapshotted onto
# every attempt at creation, so later edits never change running attempts.
FEEDBACK_MODE_IMMEDIATE = "immediate"
FEEDBACK_MODE_DEFERRED = "deferred"
VALID_FEEDBACK_MODES = (FEEDBACK_MODE_IMMEDIATE, FEEDBACK_MODE_DEFERRED)


class Certification(SQLModel, table=True):
    __tablename__ = "certifications"

    __table_args__ = (
        CheckConstraint(
            "passing_threshold_pct BETWEEN 0 AND 100",
            name="ck_certifications_passing_threshold",
        ),
        CheckConstraint(
            "feedback_mode IN ('immediate', 'deferred')",
            name="ck_certifications_feedback_mode",
        ),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    name: str = Field(max_length=255, nullable=False)
    code: str = Field(max_length=50, unique=True, nullable=False)

    # Configurable pass requirement for practice exams under this
    # certification (AC3: managed by backend/database for the MVP).
    passing_threshold_pct: int | None = Field(default=None, nullable=True)

    # When learners may see correctness feedback. 'immediate' releases the
    # verdict (never the full answer key before submission) as each question
    # is submitted; 'deferred' releases everything after final submission.
    feedback_mode: str = Field(
        default=FEEDBACK_MODE_DEFERRED,
        max_length=20,
        nullable=False,
        sa_column_kwargs={"server_default": text("'deferred'")},
    )
