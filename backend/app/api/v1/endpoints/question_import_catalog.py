"""Explicit missing-catalog resolution for staged imports (JHEP-207)."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from app.api.deps import require_administrator, require_contributor_or_administrator
from app.db.session import get_session
from app.models.question_import_batch import QuestionImportBatch
from app.models.user import User
from app.schemas.question_import import QuestionImportBatchOut
from app.schemas.question_import_catalog import (
    ImportCatalogConfirmation,
    ImportCatalogConfirmationOut,
    ImportCatalogPlan,
)
from app.services.question_import_catalog_service import (
    ImportCatalogConflictError,
    ImportCatalogNotFoundError,
    ImportCatalogPermissionError,
    confirm_import_catalog,
    get_import_catalog_plan,
)

router = APIRouter()


def _http_error(
    exc: ImportCatalogConflictError
    | ImportCatalogNotFoundError
    | ImportCatalogPermissionError,
) -> HTTPException:
    if isinstance(exc, ImportCatalogNotFoundError):
        return HTTPException(status_code=404, detail="Question import not found")
    if isinstance(exc, ImportCatalogPermissionError):
        return HTTPException(status_code=403, detail=str(exc))
    return HTTPException(
        status_code=409, detail={"code": exc.code, "message": str(exc)}
    )


@router.get("/{batch_id}/catalog-plan", response_model=ImportCatalogPlan)
def preview_missing_catalog(
    batch_id: UUID,
    actor: Annotated[User, Depends(require_contributor_or_administrator)],
    session: Annotated[Session, Depends(get_session)],
) -> ImportCatalogPlan:
    """Inspect staged references; this endpoint makes no writes."""
    try:
        return get_import_catalog_plan(session, batch_id=batch_id, actor=actor)
    except (
        ImportCatalogConflictError,
        ImportCatalogNotFoundError,
        ImportCatalogPermissionError,
    ) as exc:
        raise _http_error(exc) from exc


@router.post("/{batch_id}/catalog-confirm", response_model=ImportCatalogConfirmationOut)
def resolve_missing_catalog(
    batch_id: UUID,
    payload: ImportCatalogConfirmation,
    actor: Annotated[User, Depends(require_administrator)],
    session: Annotated[Session, Depends(get_session)],
) -> ImportCatalogConfirmationOut:
    """Create only explicitly confirmed missing catalog records; revalidate."""
    try:
        result = confirm_import_catalog(
            session, batch_id=batch_id, actor=actor, payload=payload
        )
    except (
        ImportCatalogConflictError,
        ImportCatalogNotFoundError,
        ImportCatalogPermissionError,
    ) as exc:
        raise _http_error(exc) from exc
    batch = session.get(QuestionImportBatch, result.batch_id)
    assert batch is not None
    summary = QuestionImportBatchOut.model_validate(
        {
            **batch.model_dump(),
            "can_import": batch.status == "ready" and batch.error_rows == 0,
        }
    )
    return ImportCatalogConfirmationOut(
        batch=summary,
        created_certification_ids=result.certification_ids,
        created_category_ids=result.category_ids,
    )
