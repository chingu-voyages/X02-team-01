"""Atomic Administrator publication for completed question imports."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlmodel import Session, select

from app.core.roles import UserRole
from app.models.question import Question
from app.models.question_import_batch import QuestionImportBatch
from app.models.question_import_row import QuestionImportRow
from app.models.question_version import QuestionVersion
from app.models.user import User


class QuestionImportPublishNotFoundError(LookupError):
    """The selected import batch does not exist."""


class QuestionImportPublishPermissionError(PermissionError):
    """Only an Administrator may publish an imported batch."""


class QuestionImportPublishStateError(ValueError):
    """The import batch has not completed successfully."""


class QuestionImportPublishDataError(ValueError):
    """The import provenance is missing or internally inconsistent."""


class QuestionImportPublishConflictError(ValueError):
    """One or more imported questions are no longer publishable."""


@dataclass(frozen=True)
class QuestionImportPublishResult:
    """Stable receipt for a completed or repeated bulk publication."""

    batch_id: UUID
    requested_count: int
    published_question_ids: tuple[UUID, ...]
    already_published_question_ids: tuple[UUID, ...]

    @property
    def published_count(self) -> int:
        return len(self.published_question_ids)

    @property
    def already_published_count(self) -> int:
        return len(self.already_published_question_ids)

    @property
    def all_published(self) -> bool:
        return (
            self.published_count + self.already_published_count == self.requested_count
        )


def publish_imported_questions(
    session: Session,
    *,
    batch_id: UUID,
    actor: User,
) -> QuestionImportPublishResult:
    """Approve and activate every eligible question from an imported batch.

    The entire batch is preflighted before any QuestionVersion is changed.
    All eligible versions are then updated and committed once, which prevents
    a partially published batch.
    """

    if actor.role != UserRole.ADMINISTRATOR:
        raise QuestionImportPublishPermissionError(
            "Administrator permission is required"
        )

    batch = session.exec(
        select(QuestionImportBatch)
        .where(QuestionImportBatch.id == batch_id)
        .with_for_update()
    ).first()

    if batch is None:
        raise QuestionImportPublishNotFoundError("Question import not found")

    if batch.status != "imported":
        raise QuestionImportPublishStateError(
            "Only a completed imported batch can be published"
        )

    rows = list(
        session.exec(
            select(QuestionImportRow)
            .where(QuestionImportRow.batch_id == batch.id)
            .order_by(QuestionImportRow.row_number)
            .with_for_update()
        ).all()
    )

    if (
        batch.imported_rows <= 0
        or len(rows) != batch.imported_rows
        or len(rows) != batch.total_rows
        or any(
            row.status != "imported"
            or row.created_question_id is None
            or row.created_question_version_id is None
            for row in rows
        )
    ):
        raise QuestionImportPublishDataError(
            "Imported question provenance is incomplete"
        )

    question_ids = [
        row.created_question_id for row in rows if row.created_question_id is not None
    ]

    version_ids = [
        row.created_question_version_id
        for row in rows
        if row.created_question_version_id is not None
    ]

    if len(question_ids) != len(set(question_ids)) or len(version_ids) != len(
        set(version_ids)
    ):
        raise QuestionImportPublishDataError(
            "Imported question provenance contains duplicate identifiers"
        )

    questions = list(
        session.exec(
            select(Question).where(Question.id.in_(question_ids)).with_for_update()
        ).all()
    )

    all_versions = list(
        session.exec(
            select(QuestionVersion)
            .where(QuestionVersion.question_id.in_(question_ids))
            .with_for_update()
        ).all()
    )

    question_by_id = {question.id: question for question in questions}

    version_by_id = {version.id: version for version in all_versions}

    latest_by_question: dict[
        UUID,
        QuestionVersion,
    ] = {}

    for version in all_versions:
        current = latest_by_question.get(version.question_id)

        if current is None or version.version_number > current.version_number:
            latest_by_question[version.question_id] = version

    publishable: list[tuple[UUID, QuestionVersion]] = []

    already_published: list[UUID] = []

    for row in rows:
        assert row.created_question_id is not None
        assert row.created_question_version_id is not None

        question = question_by_id.get(row.created_question_id)

        version = version_by_id.get(row.created_question_version_id)

        if question is None or version is None or version.question_id != question.id:
            raise QuestionImportPublishDataError(
                "Imported question provenance points to missing records"
            )

        latest = latest_by_question.get(question.id)

        if latest is None or latest.id != version.id:
            raise QuestionImportPublishConflictError(
                "One or more imported questions have a newer revision"
            )

        state = (
            version.review_status,
            version.publication_status,
        )

        if state == (
            "pending",
            "draft",
        ):
            publishable.append(
                (
                    question.id,
                    version,
                )
            )
            continue

        if state == (
            "approved",
            "active",
        ):
            already_published.append(question.id)
            continue

        raise QuestionImportPublishConflictError(
            "Every imported question must still be pending/draft "
            "or already approved/active"
        )

    reviewed_at = datetime.now(UTC)

    try:
        for (
            _question_id,
            version,
        ) in publishable:
            version.reviewed_by_id = actor.id
            version.reviewed_at = reviewed_at
            version.review_note = None
            version.review_status = "approved"
            version.publication_status = "active"

            session.add(version)

        session.flush()
        session.commit()

    except Exception:
        session.rollback()
        raise

    return QuestionImportPublishResult(
        batch_id=batch.id,
        requested_count=len(rows),
        published_question_ids=tuple(
            question_id
            for (
                question_id,
                _version,
            ) in publishable
        ),
        already_published_question_ids=tuple(already_published),
    )
