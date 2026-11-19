"""Stage and validate image assets for JHEP-118 imports."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from hashlib import sha256
from uuid import UUID

from sqlmodel import Session, select

from app.models.question_import_asset import QuestionImportAsset
from app.models.question_import_batch import QuestionImportBatch
from app.services.question_image_validation import (
    ValidatedQuestionImageFile,
    validate_question_image_file,
)
from app.services.question_import_parser import (
    QuestionImportParseError,
    normalize_import_image_filename,
)
from app.services.question_import_validation_service import (
    validate_question_import_batch,
)
from app.services.r2_storage import R2Storage


class QuestionImportAssetInputError(ValueError):
    """The supplied asset filename or input is invalid."""


class QuestionImportAssetConflictError(ValueError):
    """An asset filename conflicts with an existing staged asset."""


class QuestionImportAssetStateError(ValueError):
    """The import batch cannot accept additional assets in its current state."""


@dataclass(frozen=True)
class StagedQuestionImportAsset:
    """Safe staged-asset metadata returned to the API layer."""

    id: UUID
    batch_id: UUID
    source_filename: str
    normalized_filename: str
    byte_size: int
    sha256: str
    media_type: str
    status: str
    reused_existing: bool


def stage_question_import_asset(
    session: Session,
    *,
    batch: QuestionImportBatch,
    source_filename: str,
    content: bytes,
    storage: R2Storage,
) -> StagedQuestionImportAsset:
    """Validate image bytes, stage them in R2, and revalidate the batch."""

    if batch.status not in {
        "uploaded",
        "invalid",
        "ready",
    }:
        raise QuestionImportAssetStateError(
            "Import assets can only be added before the batch is committed"
        )

    try:
        normalized_filename = normalize_import_image_filename(source_filename)
    except QuestionImportParseError as exc:
        raise QuestionImportAssetInputError(exc.message) from exc

    digest = sha256(content).hexdigest()

    existing = session.exec(
        select(QuestionImportAsset).where(
            QuestionImportAsset.batch_id == batch.id,
            QuestionImportAsset.normalized_filename == normalized_filename,
        )
    ).first()

    if existing is not None:
        if existing.sha256 == digest and existing.status == "valid":
            validate_question_import_batch(
                session,
                batch_id=batch.id,
            )

            return StagedQuestionImportAsset(
                id=existing.id,
                batch_id=existing.batch_id,
                source_filename=existing.source_filename,
                normalized_filename=existing.normalized_filename,
                byte_size=existing.byte_size,
                sha256=existing.sha256 or digest,
                media_type=existing.media_type or "",
                status=existing.status,
                reused_existing=True,
            )

        raise QuestionImportAssetConflictError(
            "An image with the same normalized filename already exists "
            "in this import batch."
        )

    validated = validate_question_image_file(
        content=content,
    )

    asset = QuestionImportAsset(
        batch_id=batch.id,
        source_filename=source_filename.strip(),
        normalized_filename=normalized_filename,
        byte_size=len(validated.content),
        sha256=digest,
        media_type=validated.media_type,
        status="uploaded",
    )

    uploaded_key: str | None = None

    try:
        session.add(asset)
        session.flush()

        uploaded_key = _temporary_storage_key(
            batch_id=batch.id,
            asset_id=asset.id,
            image=validated,
        )

        storage.upload(
            key=uploaded_key,
            content=validated.content,
            media_type=validated.media_type,
        )

        asset.temporary_storage_key = uploaded_key
        asset.status = "valid"
        asset.validated_at = datetime.now(UTC)

        session.add(asset)
        session.commit()
        session.refresh(asset)

    except Exception:
        session.rollback()

        if uploaded_key is not None:
            try:
                storage.delete(
                    key=uploaded_key,
                )
            except Exception:
                pass

        raise

    validate_question_import_batch(
        session,
        batch_id=batch.id,
    )

    return StagedQuestionImportAsset(
        id=asset.id,
        batch_id=asset.batch_id,
        source_filename=asset.source_filename,
        normalized_filename=asset.normalized_filename,
        byte_size=asset.byte_size,
        sha256=asset.sha256 or digest,
        media_type=asset.media_type or "",
        status=asset.status,
        reused_existing=False,
    )


def _temporary_storage_key(
    *,
    batch_id: UUID,
    asset_id: UUID,
    image: ValidatedQuestionImageFile,
) -> str:
    return f"imports/{batch_id}/{asset_id}.{image.extension}"
