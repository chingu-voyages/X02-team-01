"""Recovery actions for staged bulk question imports."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlmodel import Session, select

from app.core.roles import UserRole
from app.models.question_import_asset import QuestionImportAsset
from app.models.question_import_batch import QuestionImportBatch
from app.models.user import User
from app.services.question_import_validation_service import (
    validate_question_import_batch,
)
from app.services.r2_storage import (
    R2Storage,
    R2StorageError,
)


class QuestionImportWorkflowNotFoundError(LookupError):
    """The batch is absent or outside the actor's permitted scope."""


class QuestionImportWorkflowStateError(ValueError):
    """The requested recovery action is invalid for the batch state."""


class QuestionImportWorkflowStorageError(RuntimeError):
    """Temporary import assets could not be removed safely."""


@dataclass(frozen=True)
class QuestionImportCancelResult:
    """Stable receipt for a completed or repeated cancellation."""

    batch_id: UUID
    discarded_asset_count: int
    already_cancelled: bool


_CANCELLABLE_STATUSES = {
    "uploaded",
    "validating",
    "invalid",
    "ready",
    "failed",
}

_REVALIDATABLE_STATUSES = {
    "uploaded",
    "invalid",
    "ready",
    "failed",
}


def cancel_question_import_batch(
    session: Session,
    *,
    batch_id: UUID,
    actor: User,
    storage: R2Storage | None,
) -> QuestionImportCancelResult:
    """Cancel one uncommitted batch and discard its temporary assets."""

    batch = _visible_batch(
        session,
        batch_id=batch_id,
        actor=actor,
        lock=True,
    )

    assets = list(
        session.exec(
            select(QuestionImportAsset)
            .where(QuestionImportAsset.batch_id == batch.id)
            .order_by(QuestionImportAsset.created_at)
        ).all()
    )

    if batch.status == "cancelled":
        return QuestionImportCancelResult(
            batch_id=batch.id,
            discarded_asset_count=sum(asset.status == "discarded" for asset in assets),
            already_cancelled=True,
        )

    if batch.status not in _CANCELLABLE_STATUSES:
        raise QuestionImportWorkflowStateError(
            "Only an uncommitted import can be cancelled"
        )

    if any(asset.status == "committed" for asset in assets):
        raise QuestionImportWorkflowStateError(
            "An import with committed image assets cannot be cancelled"
        )

    storage_keys = [
        asset.temporary_storage_key for asset in assets if asset.temporary_storage_key
    ]

    if storage_keys and storage is None:
        raise QuestionImportWorkflowStorageError(
            "Question image storage is unavailable; temporary assets were not discarded"
        )

    try:
        if storage is not None:
            for key in storage_keys:
                try:
                    storage.delete(key=key)
                except R2StorageError as exc:
                    raise QuestionImportWorkflowStorageError(
                        "Unable to discard one or more temporary import assets"
                    ) from exc

        for asset in assets:
            asset.status = "discarded"
            asset.temporary_storage_key = None
            asset.committed_at = None
            session.add(asset)

        batch.status = "cancelled"
        batch.failure_message = None
        session.add(batch)
        session.commit()
        session.refresh(batch)

    except Exception:
        session.rollback()
        raise

    return QuestionImportCancelResult(
        batch_id=batch.id,
        discarded_asset_count=len(assets),
        already_cancelled=False,
    )


def revalidate_question_import_batch(
    session: Session,
    *,
    batch_id: UUID,
    actor: User,
) -> QuestionImportBatch:
    """Rerun validation against the current catalog and question bank."""

    batch = _visible_batch(
        session,
        batch_id=batch_id,
        actor=actor,
        lock=True,
    )

    if batch.status not in _REVALIDATABLE_STATUSES:
        raise QuestionImportWorkflowStateError(
            "Only an uncommitted active import can be revalidated"
        )

    validate_question_import_batch(
        session,
        batch_id=batch.id,
    )
    session.refresh(batch)

    return batch


def reactivate_cancelled_question_import_batch(
    session: Session,
    *,
    batch: QuestionImportBatch,
) -> QuestionImportBatch:
    """Reactivate an identical cancelled workbook and validate it again."""

    if batch.status != "cancelled":
        return batch

    batch.status = "uploaded"
    batch.failure_message = None
    batch.validated_at = None
    batch.imported_rows = 0
    batch.imported_at = None

    session.add(batch)
    session.flush()

    validate_question_import_batch(
        session,
        batch_id=batch.id,
    )
    session.refresh(batch)

    return batch


def _visible_batch(
    session: Session,
    *,
    batch_id: UUID,
    actor: User,
    lock: bool,
) -> QuestionImportBatch:
    statement = select(QuestionImportBatch).where(QuestionImportBatch.id == batch_id)

    if lock:
        statement = statement.with_for_update()

    batch = session.exec(statement).first()

    if batch is None or (
        actor.role != UserRole.ADMINISTRATOR and batch.uploaded_by_id != actor.id
    ):
        raise QuestionImportWorkflowNotFoundError("Question import not found")

    return batch
