"""Explicit administrator confirmation of missing import catalog records."""

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictBool

from app.schemas.admin_certification import CertificationCreate
from app.schemas.question_import import QuestionImportBatchOut


class MissingImportCertification(BaseModel):
    code: str
    row_numbers: list[int]


class MissingImportCategory(BaseModel):
    certification_code: str
    name: str
    row_numbers: list[int]


class ImportCatalogIssue(BaseModel):
    row_number: int
    field: str
    message: str


class ImportCatalogPlan(BaseModel):
    batch_id: UUID
    plan_id: str
    missing_certifications: list[MissingImportCertification]
    missing_categories: list[MissingImportCategory]
    blocking_issues: list[ImportCatalogIssue]
    can_confirm: bool


class ImportCertificationConfiguration(CertificationCreate):
    """Reuse normal certification validation; require a numeric threshold."""

    passing_threshold_pct: int = Field(strict=True, ge=0, le=100)


class ImportCatalogConfirmation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    plan_id: str = Field(pattern=r"^[0-9a-f]{64}$")
    confirm: StrictBool
    certifications: list[ImportCertificationConfiguration] = Field(max_length=1000)


class ImportCatalogConfirmationOut(BaseModel):
    batch: QuestionImportBatchOut
    created_certification_ids: list[UUID]
    created_category_ids: list[UUID]
