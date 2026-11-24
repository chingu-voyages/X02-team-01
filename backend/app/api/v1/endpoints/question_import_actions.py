"""Recovery and publication actions for staged question imports."""

from typing import Annotated
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    status,
)
from sqlmodel import Session

from app.api.deps import (
    get_current_user,
    require_administrator,
    require_contributor_or_administrator,
)
from app.db.session import get_session
from app.models.question_import_batch import QuestionImportBatch
from app.models.user import User
from app.schemas.question_import import (
    QuestionImportBatchOut,
    QuestionImportCancelOut,
    QuestionImportPublishOut,
)
from app.services.question_import_publish_service import (
    QuestionImportPublishConflictError,
    QuestionImportPublishDataError,
    QuestionImportPublishNotFoundError,
    QuestionImportPublishPermissionError,
    QuestionImportPublishStateError,
    publish_imported_questions,
)
from app.services.question_import_workflow_service import (
    QuestionImportWorkflowNotFoundError,
    QuestionImportWorkflowStateError,
    QuestionImportWorkflowStorageError,
    cancel_question_import_batch,
    revalidate_question_import_batch,
)
from app.services.r2_storage import (
    R2ConfigurationError,
    R2Storage,
)

router = APIRouter(
    dependencies=[
        Depends(require_contributor_or_administrator),
    ],
)


def get_optional_import_r2_storage() -> R2Storage | None:
    """Return R2 storage without blocking asset-free cancellation."""

    try:
        return R2Storage()
    except R2ConfigurationError:
        return None


@router.post(
    "/{batch_id}/cancel",
    response_model=QuestionImportCancelOut,
)
def cancel_question_import(
    batch_id: UUID,
    current_user: Annotated[
        User,
        Depends(get_current_user),
    ],
    session: Annotated[
        Session,
        Depends(get_session),
    ],
    storage: Annotated[
        R2Storage | None,
        Depends(get_optional_import_r2_storage),
    ],
) -> QuestionImportCancelOut:
    """Cancel an uncommitted import and discard temporary images."""

    try:
        result = cancel_question_import_batch(
            session,
            batch_id=batch_id,
            actor=current_user,
            storage=storage,
        )
    except QuestionImportWorkflowNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Question import not found",
        ) from exc
    except QuestionImportWorkflowStateError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "IMPORT_CANNOT_BE_CANCELLED",
                "message": str(exc),
            },
        ) from exc
    except QuestionImportWorkflowStorageError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "IMPORT_ASSET_CLEANUP_UNAVAILABLE",
                "message": str(exc),
            },
        ) from exc

    batch = session.get(
        QuestionImportBatch,
        result.batch_id,
    )
    assert batch is not None

    return QuestionImportCancelOut(
        batch=_batch_response(batch),
        discarded_asset_count=result.discarded_asset_count,
        already_cancelled=result.already_cancelled,
    )


@router.post(
    "/{batch_id}/revalidate",
    response_model=QuestionImportBatchOut,
)
def revalidate_question_import(
    batch_id: UUID,
    current_user: Annotated[
        User,
        Depends(get_current_user),
    ],
    session: Annotated[
        Session,
        Depends(get_session),
    ],
) -> QuestionImportBatchOut:
    """Rerun validation after catalog or image conditions change."""

    try:
        batch = revalidate_question_import_batch(
            session,
            batch_id=batch_id,
            actor=current_user,
        )
    except QuestionImportWorkflowNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Question import not found",
        ) from exc
    except QuestionImportWorkflowStateError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "IMPORT_CANNOT_BE_REVALIDATED",
                "message": str(exc),
            },
        ) from exc

    return _batch_response(batch)


@router.post(
    "/{batch_id}/publish",
    response_model=QuestionImportPublishOut,
)
def publish_question_import(
    batch_id: UUID,
    current_user: Annotated[
        User,
        Depends(require_administrator),
    ],
    session: Annotated[
        Session,
        Depends(get_session),
    ],
) -> QuestionImportPublishOut:
    """Approve and activate every eligible question from one import."""

    try:
        result = publish_imported_questions(
            session,
            batch_id=batch_id,
            actor=current_user,
        )
    except QuestionImportPublishNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Question import not found",
        ) from exc
    except QuestionImportPublishPermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions",
        ) from exc
    except QuestionImportPublishStateError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "IMPORT_BATCH_NOT_IMPORTED",
                "message": str(exc),
            },
        ) from exc
    except QuestionImportPublishDataError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "IMPORT_PUBLICATION_DATA_INVALID",
                "message": str(exc),
            },
        ) from exc
    except QuestionImportPublishConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "IMPORT_QUESTIONS_NOT_PUBLISHABLE",
                "message": str(exc),
            },
        ) from exc

    batch = session.get(
        QuestionImportBatch,
        result.batch_id,
    )
    assert batch is not None

    return QuestionImportPublishOut(
        batch=_batch_response(batch),
        requested_count=result.requested_count,
        published_count=result.published_count,
        already_published_count=(result.already_published_count),
        published_question_ids=list(result.published_question_ids),
        already_published_question_ids=list(result.already_published_question_ids),
        all_published=result.all_published,
    )


def _batch_response(
    batch: QuestionImportBatch,
) -> QuestionImportBatchOut:
    return QuestionImportBatchOut(
        id=batch.id,
        original_filename=batch.original_filename,
        template_version=batch.template_version,
        status=batch.status,
        total_rows=batch.total_rows,
        valid_rows=batch.valid_rows,
        error_rows=batch.error_rows,
        warning_rows=batch.warning_rows,
        imported_rows=batch.imported_rows,
        can_import=(batch.status == "ready" and batch.error_rows == 0),
        created_at=batch.created_at,
        validated_at=batch.validated_at,
        imported_at=batch.imported_at,
    )
