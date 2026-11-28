from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, UniqueConstraint
from sqlmodel import Field, SQLModel


class RubricCriterion(SQLModel, table=True):
    __tablename__ = "rubric_criteria"

    __table_args__ = (
        CheckConstraint(
            "position > 0",
            name="ck_rubric_criteria_positive_position",
        ),
        CheckConstraint(
            "length(trim(name)) > 0",
            name="ck_rubric_criteria_nonempty_name",
        ),
        CheckConstraint(
            "points > 0",
            name="ck_rubric_criteria_positive_points",
        ),
        UniqueConstraint(
            "question_version_id",
            "position",
            name="uq_rubric_criteria_version_position",
        ),
    )

    id: UUID = Field(
        default_factory=uuid4,
        primary_key=True,
    )

    question_version_id: UUID = Field(
        foreign_key="question_versions.id",
        nullable=False,
    )

    # Stable display order within the version's rubric (1-based).
    position: int = Field(nullable=False)

    name: str = Field(
        max_length=200,
        nullable=False,
    )

    # JHEP-121 AC2: positive point values only; the version's total is the
    # sum of its criteria and equals text_answer_keys.max_points.
    points: int = Field(nullable=False)
