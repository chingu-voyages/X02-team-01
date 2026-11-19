"""Bulk question-import upload and validation-preview endpoints."""

from hashlib import sha256
from typing import Annotated, Literal
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from sqlmodel import Session, func, select

from app.api.deps import (
    get_current_user,
    require_contributor_or_administrator,
)
from app.core.config import settings
from app.core.roles import UserRole
from app.db.session import get_session
from app.models.question_import_batch import QuestionImportBatch
from app.models.question_import_row import QuestionImportRow
from app.models.user import User
from app.schemas.question_import import (
    QuestionImportAssetOut,
    QuestionImportAssetUploadOut,
    QuestionImportBatchOut,
    QuestionImportCommitOut,
    QuestionImportIssueOut,
    QuestionImportRowOut,
    QuestionImportRowsPage,
)
from app.services.question_image_validation import (
    QuestionImageDimensionsError,
    QuestionImageInvalidContentError,
    QuestionImageTooLargeError,
    QuestionImageUnsupportedTypeError,
)
from app.services.question_import_asset_service import (
    QuestionImportAssetConflictError,
    QuestionImportAssetInputError,
    QuestionImportAssetStateError,
    stage_question_import_asset,
)
from app.services.question_import_commit_service import (
    QuestionImportCommitConflictError,
    QuestionImportCommitDataError,
    QuestionImportCommitNotFoundError,
    QuestionImportCommitNotReadyError,
    commit_question_import_batch,
)
from app.services.question_import_parser import (
    MAX_WORKBOOK_BYTES,
    QuestionImportParseError,
    parse_question_bank_workbook,
)
from app.services.question_import_validation_service import (
    validate_question_import_batch,
)
from app.services.r2_storage import (
    R2ConfigurationError,
    R2Storage,
    R2StorageError,
)

router = APIRouter(dependencies=[Depends(require_contributor_or_administrator)])


def get_import_r2_storage() -> R2Storage:
    """Resolve backend-only object storage for staged import assets."""

    try:
        return R2Storage()

    except R2ConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Question image storage is unavailable",
        ) from exc


@router.post(
    "",
    response_model=QuestionImportBatchOut,
    status_code=status.HTTP_201_CREATED,
)
async def upload_question_import(
    response: Response,
    current_user: Annotated[
        User,
        Depends(get_current_user),
    ],
    session: Annotated[
        Session,
        Depends(get_session),
    ],
    file: Annotated[
        UploadFile,
        File(...),
    ],
) -> QuestionImportBatchOut:
    """Stage and validate one contract-v2 XLSX workbook."""

    try:
        content = await file.read(MAX_WORKBOOK_BYTES + 1)
    finally:
        await file.close()

    original_filename = file.filename or ""

    digest = sha256(content).hexdigest()

    existing = session.exec(
        select(QuestionImportBatch).where(
            QuestionImportBatch.uploaded_by_id == current_user.id,
            QuestionImportBatch.file_sha256 == digest,
        )
    ).first()

    if existing is not None:
        response.status_code = status.HTTP_200_OK

        return _batch_response(existing)

    try:
        parsed = parse_question_bank_workbook(
            filename=(original_filename),
            content=content,
        )

    except QuestionImportParseError as exc:
        http_status = (
            status.HTTP_413_CONTENT_TOO_LARGE
            if exc.code == "FILE_TOO_LARGE"
            else status.HTTP_422_UNPROCESSABLE_CONTENT
        )

        raise HTTPException(
            status_code=http_status,
            detail={
                "code": exc.code,
                "message": exc.message,
                "sheet": exc.sheet,
                "row": exc.row,
                "field": exc.field,
                "cell": exc.cell,
            },
        ) from exc

    batch = QuestionImportBatch(
        uploaded_by_id=(current_user.id),
        original_filename=(parsed.original_filename),
        file_type="xlsx",
        file_size_bytes=len(content),
        file_sha256=digest,
        template_version=(parsed.template_version),
        status="uploaded",
    )

    try:
        session.add(batch)
        session.flush()

        for parsed_row in parsed.rows:
            session.add(
                QuestionImportRow(
                    batch_id=batch.id,
                    row_number=(parsed_row.row_number),
                    raw_payload=(parsed_row.values),
                )
            )

        session.commit()

    except Exception:
        session.rollback()
        raise

    validate_question_import_batch(
        session,
        batch_id=batch.id,
    )

    session.refresh(batch)

    return _batch_response(batch)


@router.post(
    "/{batch_id}/assets",
    response_model=QuestionImportAssetUploadOut,
    status_code=status.HTTP_201_CREATED,
)
async def upload_question_import_asset(
    batch_id: UUID,
    response: Response,
    current_user: Annotated[
        User,
        Depends(get_current_user),
    ],
    session: Annotated[
        Session,
        Depends(get_session),
    ],
    storage: Annotated[
        R2Storage,
        Depends(get_import_r2_storage),
    ],
    file: Annotated[
        UploadFile,
        File(...),
    ],
) -> QuestionImportAssetUploadOut:
    """Validate and stage one PNG/JPEG/WebP import asset, then revalidate."""

    batch = _visible_batch(
        session,
        batch_id=batch_id,
        actor=current_user,
    )

    try:
        content = await file.read(settings.max_question_image_bytes + 1)
    finally:
        await file.close()

    source_filename = file.filename or ""

    try:
        staged = stage_question_import_asset(
            session,
            batch=batch,
            source_filename=(source_filename),
            content=content,
            storage=storage,
        )

    except QuestionImageTooLargeError as exc:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=str(exc),
        ) from exc

    except QuestionImageUnsupportedTypeError as exc:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=str(exc),
        ) from exc

    except (
        QuestionImageInvalidContentError,
        QuestionImageDimensionsError,
        QuestionImportAssetInputError,
    ) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc

    except (
        QuestionImportAssetConflictError,
        QuestionImportAssetStateError,
    ) as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc

    except R2StorageError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Question image storage is unavailable",
        ) from exc

    if staged.reused_existing:
        response.status_code = status.HTTP_200_OK

    session.refresh(batch)

    return QuestionImportAssetUploadOut(
        asset=QuestionImportAssetOut(
            id=staged.id,
            source_filename=(staged.source_filename),
            media_type=(staged.media_type),
            byte_size=(staged.byte_size),
            status=staged.status,
        ),
        batch=_batch_response(batch),
    )


@router.post(
    "/{batch_id}/commit",
    response_model=QuestionImportCommitOut,
)
def commit_question_import(
    batch_id: UUID,
    current_user: Annotated[
        User,
        Depends(get_current_user),
    ],
    session: Annotated[
        Session,
        Depends(get_session),
    ],
) -> QuestionImportCommitOut:
    """Atomically create real pending Draft questions from a ready batch."""

    try:
        result = commit_question_import_batch(
            session,
            batch_id=batch_id,
            actor=current_user,
        )

    except QuestionImportCommitNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Question import not found",
        ) from exc

    except QuestionImportCommitNotReadyError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "IMPORT_NOT_READY",
                "message": str(exc),
            },
        ) from exc

    except QuestionImportCommitConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "IMPORT_STALE",
                "message": str(exc),
            },
        ) from exc

    except QuestionImportCommitDataError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "IMPORT_DATA_INVALID",
                "message": str(exc),
            },
        ) from exc

    batch = session.get(
        QuestionImportBatch,
        batch_id,
    )

    assert batch is not None

    return QuestionImportCommitOut(
        batch=_batch_response(batch),
        created_count=(result.imported_rows),
        created_question_ids=list(result.created_question_ids),
        already_imported=(result.already_imported),
    )


@router.get(
    "/{batch_id}",
    response_model=QuestionImportBatchOut,
)
def get_question_import(
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
    """Return one import summary within the manager's permitted scope."""

    batch = _visible_batch(
        session,
        batch_id=batch_id,
        actor=current_user,
    )

    return _batch_response(batch)


@router.get(
    "/{batch_id}/rows",
    response_model=QuestionImportRowsPage,
)
def list_question_import_rows(
    batch_id: UUID,
    current_user: Annotated[
        User,
        Depends(get_current_user),
    ],
    session: Annotated[
        Session,
        Depends(get_session),
    ],
    row_status: Literal[
        "pending",
        "valid",
        "invalid",
        "imported",
        "failed",
    ]
    | None = None,
    page: Annotated[
        int,
        Query(ge=1),
    ] = 1,
    page_size: Annotated[
        int,
        Query(
            ge=1,
            le=100,
        ),
    ] = 50,
) -> QuestionImportRowsPage:
    """Return paginated staged rows and their validation issues."""

    batch = _visible_batch(
        session,
        batch_id=batch_id,
        actor=current_user,
    )

    statement = select(QuestionImportRow).where(QuestionImportRow.batch_id == batch.id)

    if row_status is not None:
        statement = statement.where(QuestionImportRow.status == row_status)

    count_statement = select(func.count()).select_from(statement.subquery())

    total = int(session.exec(count_statement).one())

    rows = session.exec(
        statement.order_by(QuestionImportRow.row_number)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()

    return QuestionImportRowsPage(
        items=[_row_response(row) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


def _visible_batch(
    session: Session,
    *,
    batch_id: UUID,
    actor: User,
) -> QuestionImportBatch:
    batch = session.get(
        QuestionImportBatch,
        batch_id,
    )

    if batch is None or (
        actor.role != UserRole.ADMINISTRATOR and batch.uploaded_by_id != actor.id
    ):
        # Use 404 for contributor isolation so batch IDs cannot be probed.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Question import not found",
        )

    return batch


def _batch_response(
    batch: QuestionImportBatch,
) -> QuestionImportBatchOut:
    return QuestionImportBatchOut(
        id=batch.id,
        original_filename=(batch.original_filename),
        template_version=(batch.template_version),
        status=batch.status,
        total_rows=(batch.total_rows),
        valid_rows=(batch.valid_rows),
        error_rows=(batch.error_rows),
        warning_rows=(batch.warning_rows),
        imported_rows=(batch.imported_rows),
        can_import=(batch.status == "ready" and batch.error_rows == 0),
        created_at=(batch.created_at),
        validated_at=(batch.validated_at),
        imported_at=(batch.imported_at),
    )


def _row_response(
    row: QuestionImportRow,
) -> QuestionImportRowOut:
    payload = row.normalized_payload or row.raw_payload or {}

    return QuestionImportRowOut(
        id=row.id,
        row_number=(row.row_number),
        status=row.status,
        certification_code=_optional_text(payload.get("certification_code")),
        category_name=_optional_text(payload.get("category_name")),
        question_type=_optional_text(payload.get("question_type")),
        question_text=_optional_text(payload.get("question_text")),
        image_filename=_optional_text(payload.get("image_filename")),
        issues=[
            QuestionImportIssueOut.model_validate(issue)
            for issue in (row.validation_issues)
        ],
    )


def _optional_text(
    value: object,
) -> str | None:
    if value is None:
        return None

    return str(value)
