"""Persistent retirement rules for practice questions (JHEP-130)."""

from dataclasses import dataclass
from uuid import UUID

from sqlmodel import Session, select

from app.models.question import Question
from app.models.question_version import QuestionVersion


class QuestionRetirementNotFoundError(LookupError):
    """The requested question does not exist."""


class QuestionNotRetirableError(ValueError):
    """The question has no active published version to retire."""


@dataclass(frozen=True)
class QuestionRetirementResult:
    """Persistent result of a successful or idempotent retirement."""

    question_id: UUID
    retired_version_ids: tuple[UUID, ...]
    already_retired: bool


def retire_question(
    session: Session,
    question_id: UUID,
) -> QuestionRetirementResult:
    """Retire a published question without deleting historical records.

    A question is considered retired when all of its stored versions are inactive.
    If the question has an active published version, every version is moved to the
    ``retired`` publication state in one transaction. This also closes any pending
    draft revision so it cannot later be published accidentally after retirement.

    Existing question/version IDs are never changed or deleted, so exam-attempt
    rows pinned to an older version remain valid for historical results.
    """
    question = session.get(Question, question_id)
    if question is None:
        raise QuestionRetirementNotFoundError("Question not found")

    versions = session.exec(
        select(QuestionVersion)
        .where(QuestionVersion.question_id == question.id)
        .order_by(QuestionVersion.version_number)
    ).all()

    active_versions = [
        version for version in versions if version.publication_status == "active"
    ]

    if not active_versions:
        if versions and all(
            version.publication_status == "retired" for version in versions
        ):
            return QuestionRetirementResult(
                question_id=question.id,
                retired_version_ids=tuple(version.id for version in versions),
                already_retired=True,
            )

        raise QuestionNotRetirableError(
            "Only active published questions can be retired"
        )

    try:
        for version in versions:
            version.publication_status = "retired"
            session.add(version)

        session.commit()
    except Exception:
        session.rollback()
        raise

    return QuestionRetirementResult(
        question_id=question.id,
        retired_version_ids=tuple(version.id for version in versions),
        already_retired=False,
    )
