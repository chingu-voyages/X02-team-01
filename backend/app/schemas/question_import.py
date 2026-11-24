"""API schemas for JHEP-118 bulk question imports."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

QuestionImportBatchStatus = Literal[
    "uploaded",
    "validating",
    "invalid",
    "ready",
    "importing",
    "imported",
    "failed",
    "cancelled",
]

QuestionImportRowStatus = Literal[
    "pending",
    "valid",
    "invalid",
    "imported",
    "failed",
]

QuestionImportSeverity = Literal[
    "error",
    "warning",
]


class QuestionImportIssueOut(BaseModel):
    """Stable row/file issue shape shown in the import preview."""

    sheet: str | None = None
    row: int | None = None
    field: str | None = None
    cell: str | None = None

    severity: QuestionImportSeverity
    code: str
    message: str

    value_preview: str | None = None
    related_rows: list[int] = Field(default_factory=list)
    asset_filename: str | None = None


class QuestionImportBatchOut(BaseModel):
    """Safe summary for one authorized import batch."""

    id: UUID
    original_filename: str
    template_version: str
    status: QuestionImportBatchStatus

    total_rows: int
    valid_rows: int
    error_rows: int
    warning_rows: int
    imported_rows: int

    can_import: bool

    created_at: datetime
    validated_at: datetime | None = None
    imported_at: datetime | None = None


class QuestionImportRowOut(BaseModel):
    """One staged Questions-sheet row for preview/error review."""

    id: UUID
    row_number: int
    status: QuestionImportRowStatus

    certification_code: str | None = None
    category_name: str | None = None
    question_type: str | None = None
    question_text: str | None = None
    image_filename: str | None = None

    issues: list[QuestionImportIssueOut] = Field(default_factory=list)


class QuestionImportRowsPage(BaseModel):
    """Paginated staged-row preview."""

    items: list[QuestionImportRowOut]
    total: int
    page: int
    page_size: int


class QuestionImportAssetOut(BaseModel):
    """Safe staged-image metadata for the import UI."""

    id: UUID
    source_filename: str
    media_type: Literal[
        "image/png",
        "image/jpeg",
        "image/webp",
    ]
    byte_size: int
    status: Literal[
        "uploaded",
        "valid",
        "invalid",
        "committed",
        "discarded",
    ]


class QuestionImportAssetUploadOut(BaseModel):
    """Asset upload result plus the batch's new validation state."""

    asset: QuestionImportAssetOut
    batch: QuestionImportBatchOut


class QuestionImportCommitOut(BaseModel):
    """Result of an explicit import confirmation."""

    batch: QuestionImportBatchOut
    created_count: int
    created_question_ids: list[UUID]
    already_imported: bool


class QuestionImportPublishOut(BaseModel):
    """Result of bulk approving and publishing an imported batch."""

    batch: QuestionImportBatchOut
    requested_count: int
    published_count: int
    already_published_count: int
    published_question_ids: list[UUID]
    already_published_question_ids: list[UUID]
    all_published: bool


class QuestionImportCancelOut(BaseModel):
    """Result of cancelling or repeating cancellation for one batch."""

    batch: QuestionImportBatchOut
    discarded_asset_count: int
    already_cancelled: bool


class QuestionImportHistoryItemOut(QuestionImportBatchOut):
    """One recent import with uploader identity for audit/history views."""

    uploaded_by_id: UUID
    uploaded_by_email: str
    uploaded_by_name: str


class QuestionImportHistoryPage(BaseModel):
    """Paginated recent question-import history."""

    items: list[QuestionImportHistoryItemOut]
    total: int
    page: int
    page_size: int
