from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, text
from sqlmodel import Field, SQLModel

FEEDBACK_MODE_IMMEDIATE = "immediate"
FEEDBACK_MODE_DEFERRED = "deferred"

VALID_FEEDBACK_MODES = (
    FEEDBACK_MODE_IMMEDIATE,
    FEEDBACK_MODE_DEFERRED,
)


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

    id: UUID = Field(
        default_factory=uuid4,
        primary_key=True,
    )

    name: str = Field(
        max_length=255,
        nullable=False,
    )

    code: str = Field(
        max_length=50,
        unique=True,
        nullable=False,
    )

    passing_threshold_pct: int | None = Field(
        default=None,
        nullable=True,
    )

    feedback_mode: str = Field(
        default=FEEDBACK_MODE_DEFERRED,
        max_length=20,
        nullable=False,
        sa_column_kwargs={
            "server_default": text("'deferred'"),
        },
    )

    # Existing certifications predate the publication lifecycle and remain
    # published after migration. Administrative creation explicitly writes
    # False so new content must be published deliberately.
    is_published: bool = Field(
        default=True,
        nullable=False,
        sa_column_kwargs={
            "server_default": text("true"),
        },
    )
