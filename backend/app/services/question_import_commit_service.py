"""Atomic persistence for validated JHEP-118 question imports."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from pydantic import ValidationError
from sqlmodel import Session, select

from app.core.roles import UserRole
from app.models.question import Question
from app.models.question_image import QuestionImage
from app.models.question_import_asset import QuestionImportAsset
from app.models.question_import_batch import QuestionImportBatch
from app.models.question_import_row import QuestionImportRow
from app.models.question_version import QuestionVersion
from app.models.user import User
from app.schemas.admin_question import QuestionDraftCreate
from app.services.admin_question_service import (
    QuestionDraftScopeError,
    add_question_draft,
)
from app.services.question_import_validation_service import (
    question_content_fingerprint,
)


class QuestionImportCommitNotFoundError(LookupError):
    """Import batch is absent or outside the current actor's scope."""


class QuestionImportCommitNotReadyError(ValueError):
    """Import batch has blocking validation errors or is not ready."""


class QuestionImportCommitConflictError(ValueError):
    """Question-bank state changed after validation."""


class QuestionImportCommitDataError(ValueError):
    """Stored normalized import data can no longer be persisted safely."""


@dataclass(frozen=True)
class QuestionImportCommitResult:
    """Stable receipt for one completed or repeated import confirmation."""

    batch_id: UUID
    created_question_ids: tuple[UUID, ...]
    imported_rows: int
    already_imported: bool


def commit_question_import_batch(
    session: Session,
    *,
    batch_id: UUID,
    actor: User,
) -> QuestionImportCommitResult:
    """Persist a ready import atomically as pending Draft questions."""

    batch = session.exec(
        select(QuestionImportBatch)
        .where(QuestionImportBatch.id == batch_id)
        .with_for_update()
    ).first()

    if batch is None or (
        actor.role != UserRole.ADMINISTRATOR and batch.uploaded_by_id != actor.id
    ):
        raise QuestionImportCommitNotFoundError("Question import not found")

    rows = list(
        session.exec(
            select(QuestionImportRow)
            .where(QuestionImportRow.batch_id == batch.id)
            .order_by(QuestionImportRow.row_number)
        ).all()
    )

    if batch.status == "imported":
        created_ids = tuple(
            row.created_question_id
            for row in rows
            if (row.created_question_id is not None)
        )

        return QuestionImportCommitResult(
            batch_id=batch.id,
            created_question_ids=created_ids,
            imported_rows=(batch.imported_rows),
            already_imported=True,
        )

    if batch.status != "ready" or batch.error_rows != 0:
        raise QuestionImportCommitNotReadyError(
            "Only a fully validated ready import can be committed"
        )

    if (
        not rows
        or len(rows) != batch.total_rows
        or any(
            row.status != "valid"
            or row.normalized_payload is None
            or row.content_fingerprint is None
            for row in rows
        )
    ):
        raise QuestionImportCommitDataError(
            "Import validation data is incomplete or stale"
        )

    fingerprints = [
        row.content_fingerprint for row in rows if row.content_fingerprint is not None
    ]

    if len(fingerprints) != len(set(fingerprints)):
        raise QuestionImportCommitConflictError(
            "Import now contains duplicate question identities"
        )

    existing_fingerprints = _existing_question_fingerprints(session)

    stale_duplicates = [
        row.row_number
        for row in rows
        if row.content_fingerprint in existing_fingerprints
    ]

    if stale_duplicates:
        joined = ", ".join(str(value) for value in stale_duplicates)

        raise QuestionImportCommitConflictError(
            "Question-bank state changed after validation; "
            f"duplicate rows now exist: {joined}"
        )

    assets = list(
        session.exec(
            select(QuestionImportAsset).where(QuestionImportAsset.batch_id == batch.id)
        ).all()
    )

    asset_by_id = {asset.id: asset for asset in assets}

    now = datetime.now(UTC)
    created_ids: list[UUID] = []
    used_asset_ids: set[UUID] = set()

    try:
        batch.status = "importing"
        session.add(batch)

        for row in rows:
            normalized = dict(row.normalized_payload or {})

            image_filename = normalized.pop(
                "image_filename",
                None,
            )
            image_alt_text = normalized.pop(
                "image_alt_text",
                None,
            )

            try:
                payload = QuestionDraftCreate.model_validate(normalized)
            except ValidationError as exc:
                raise QuestionImportCommitDataError(
                    f"Stored validated row {row.row_number} is no longer valid"
                ) from exc

            try:
                created = add_question_draft(
                    session,
                    payload,
                    actor_id=(batch.uploaded_by_id),
                )
            except QuestionDraftScopeError as exc:
                raise QuestionImportCommitConflictError(
                    "Catalog state changed after validation "
                    f"for row {row.row_number}: {exc}"
                ) from exc

            if row.matched_asset_id is not None:
                asset = asset_by_id.get(row.matched_asset_id)

                if (
                    asset is None
                    or asset.status
                    not in {
                        "valid",
                        "committed",
                    }
                    or not asset.temporary_storage_key
                    or not asset.media_type
                    or not image_filename
                    or not image_alt_text
                ):
                    raise QuestionImportCommitDataError(
                        "Validated image metadata is incomplete "
                        f"for row {row.row_number}"
                    )

                session.add(
                    QuestionImage(
                        question_version_id=(created.question_version_id),
                        storage_key=(asset.temporary_storage_key),
                        alt_text=str(image_alt_text),
                        media_type=(asset.media_type),
                        position=1,
                    )
                )

                used_asset_ids.add(asset.id)

            row.created_question_id = created.question_id
            row.created_question_version_id = created.question_version_id
            row.status = "imported"
            row.imported_at = now

            session.add(row)
            created_ids.append(created.question_id)

        session.flush()

        for asset in assets:
            if asset.id in used_asset_ids:
                asset.status = "committed"
                asset.committed_at = now
                session.add(asset)

        batch.status = "imported"
        batch.imported_rows = len(created_ids)
        batch.imported_at = now
        batch.failure_message = None

        session.add(batch)
        session.commit()

    except (
        QuestionImportCommitConflictError,
        QuestionImportCommitDataError,
    ):
        session.rollback()
        raise

    except Exception:
        session.rollback()
        raise

    return QuestionImportCommitResult(
        batch_id=batch.id,
        created_question_ids=tuple(created_ids),
        imported_rows=len(created_ids),
        already_imported=False,
    )


def _existing_question_fingerprints(
    session: Session,
) -> set[str]:
    rows = session.exec(
        select(
            Question,
            QuestionVersion,
        ).join(
            QuestionVersion,
            QuestionVersion.question_id == Question.id,
        )
    ).all()

    return {
        question_content_fingerprint(
            certification_id=(question.certification_id),
            category_id=(question.category_id),
            question_type=(version.question_type),
            question_text=(version.question_text),
        )
        for (
            question,
            version,
        ) in rows
    }
