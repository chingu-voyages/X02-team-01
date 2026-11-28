"""Read-only missing-catalog preview and explicit, atomic resolution (JHEP-207).

Question validation and commit remain unchanged. The confirmation action creates
only records derived from the stored workbook and revalidates in the same
transaction. It never imports questions or publishes catalog content.
"""

import hashlib
import json
from collections import defaultdict
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.core.roles import UserRole
from app.models.category import Category
from app.models.certification import Certification
from app.models.question_import_batch import QuestionImportBatch
from app.models.question_import_row import QuestionImportRow
from app.models.user import User
from app.schemas.question_import_catalog import (
    ImportCatalogConfirmation,
    ImportCatalogIssue,
    ImportCatalogPlan,
    MissingImportCategory,
    MissingImportCertification,
)
from app.services.question_import_parser import IMPORT_TEMPLATE_VERSION
from app.services.question_import_validation_service import (
    normalize_import_text,
    validate_question_import_batch,
)


class ImportCatalogNotFoundError(LookupError):
    """Import does not exist or is outside the actor's scope."""


class ImportCatalogPermissionError(PermissionError):
    """Only administrators may resolve missing catalog records."""


class ImportCatalogConflictError(ValueError):
    """Confirmation is missing, stale, or cannot be applied safely."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


@dataclass(frozen=True)
class CatalogResolution:
    batch_id: UUID
    certification_ids: list[UUID]
    category_ids: list[UUID]


def _batch(
    session: Session, batch_id: UUID, actor: User, *, lock: bool = False
) -> QuestionImportBatch:
    statement = select(QuestionImportBatch).where(QuestionImportBatch.id == batch_id)
    if lock:
        statement = statement.with_for_update()
    batch = session.exec(statement).first()
    if batch is None or (
        actor.role != UserRole.ADMINISTRATOR and batch.uploaded_by_id != actor.id
    ):
        raise ImportCatalogNotFoundError("Question import not found")
    if batch.status not in {"ready", "invalid"} or batch.validated_at is None:
        raise ImportCatalogConflictError(
            "IMPORT_CATALOG_NOT_AVAILABLE",
            "Only active, validated, uncommitted imports can resolve catalog records.",
        )
    return batch


def _text(value: object) -> str | None:
    normalized = normalize_import_text(value)
    if normalized is not None and any(ord(char) < 32 for char in normalized):
        raise ValueError("Catalog identifiers cannot contain control characters.")
    return normalized


def _plan(
    session: Session, batch: QuestionImportBatch
) -> tuple[ImportCatalogPlan, dict[str, Certification]]:
    certifications = session.exec(select(Certification)).all()
    categories = session.exec(select(Category)).all()
    by_code: dict[str, list[Certification]] = defaultdict(list)
    by_folded_code: dict[str, list[Certification]] = defaultdict(list)
    by_category: dict[tuple[UUID, str], list[Category]] = defaultdict(list)
    for certification in certifications:
        code = certification.code.strip()
        by_code[code].append(certification)
        by_folded_code[code.casefold()].append(certification)
    for category in categories:
        by_category[
            (category.certification_id, category.name.strip().casefold())
        ].append(category)

    rows = session.exec(
        select(QuestionImportRow)
        .where(QuestionImportRow.batch_id == batch.id)
        .order_by(QuestionImportRow.row_number)
    ).all()
    missing_certifications: dict[str, list[int]] = defaultdict(list)
    missing_categories: dict[tuple[str, str], MissingImportCategory] = {}
    existing_parents: dict[str, Certification] = {}
    issues: list[ImportCatalogIssue] = []

    def issue(row: QuestionImportRow, field: str, message: str) -> None:
        issues.append(
            ImportCatalogIssue(row_number=row.row_number, field=field, message=message)
        )

    for row in rows:
        raw = row.raw_payload
        try:
            version = _text(raw.get("template_version"))
            code = _text(raw.get("certification_code"))
        except ValueError as exc:
            issue(row, "certification_code", str(exc))
            continue
        if version != IMPORT_TEMPLATE_VERSION:
            issue(
                row, "template_version", "Correct the workbook template version first."
            )
            continue
        if code is None or len(code) > 50:
            issue(
                row,
                "certification_code",
                "Enter a certification code of 1–50 characters in the workbook.",
            )
            continue

        matches = by_code[code]
        parent = None
        if len(matches) > 1:
            issue(
                row,
                "certification_code",
                "Certification code is ambiguous. Resolve it in Catalog first.",
            )
            continue
        if matches:
            parent = matches[0]
            existing_parents[code] = parent
        else:
            # The workbook validator uses exact code matching; normal admin
            # creation uppercases codes. Never invent a case mapping or create
            # a second certification merely because the workbook case differs.
            if code != code.upper() or by_folded_code[code.casefold()]:
                issue(
                    row,
                    "certification_code",
                    "Use the exact existing certification code, or an uppercase new code, in the workbook.",
                )
                continue
            missing_certifications[code].append(row.row_number)

        try:
            name = _text(raw.get("category_name"))
        except ValueError as exc:
            issue(row, "category_name", str(exc))
            continue
        if name is None:
            # A blank category is deliberately allowed by import contract v2.
            continue
        if len(name) > 255:
            issue(
                row,
                "category_name",
                "Category name must contain at most 255 characters.",
            )
            continue
        category_matches = (
            by_category[(parent.id, name.casefold())] if parent is not None else []
        )
        if len(category_matches) > 1:
            issue(
                row,
                "category_name",
                "Category name is ambiguous. Resolve it in Catalog first.",
            )
            continue
        if category_matches:
            continue
        # Category matching in the existing validator is case-insensitive.
        # Keep the first workbook spelling and group subsequent references.
        key = (code, name.casefold())
        candidate = missing_categories.setdefault(
            key,
            MissingImportCategory(certification_code=code, name=name, row_numbers=[]),
        )
        candidate.row_numbers.append(row.row_number)

    certs = [
        MissingImportCertification(code=code, row_numbers=numbers)
        for code, numbers in sorted(missing_certifications.items())
    ]
    cats = [missing_categories[key] for key in sorted(missing_categories)]
    digest = hashlib.sha256(
        json.dumps(
            {
                "batch_id": str(batch.id),
                "validated_at": batch.validated_at.isoformat()
                if batch.validated_at
                else None,
                "certifications": [item.model_dump(mode="json") for item in certs],
                "categories": [item.model_dump(mode="json") for item in cats],
                "issues": [item.model_dump(mode="json") for item in issues],
                "parents": {
                    code: str(parent.id) for code, parent in existing_parents.items()
                },
            },
            sort_keys=True,
            ensure_ascii=False,
        ).encode("utf-8")
    ).hexdigest()
    return (
        ImportCatalogPlan(
            batch_id=batch.id,
            plan_id=digest,
            missing_certifications=certs,
            missing_categories=cats,
            blocking_issues=issues,
            can_confirm=bool(certs or cats) and not issues,
        ),
        existing_parents,
    )


def get_import_catalog_plan(
    session: Session, *, batch_id: UUID, actor: User
) -> ImportCatalogPlan:
    """Compute a preview without changing any catalog or import record."""
    if actor.role not in {UserRole.ADMINISTRATOR, UserRole.CONTRIBUTOR}:
        raise ImportCatalogPermissionError("Insufficient permissions")
    plan, _ = _plan(session, _batch(session, batch_id, actor))
    if actor.role != UserRole.ADMINISTRATOR:
        return plan.model_copy(update={"can_confirm": False})
    return plan


def confirm_import_catalog(
    session: Session,
    *,
    batch_id: UUID,
    actor: User,
    payload: ImportCatalogConfirmation,
) -> CatalogResolution:
    """Create the exact missing catalog records; then revalidate atomically."""
    if actor.role != UserRole.ADMINISTRATOR:
        raise ImportCatalogPermissionError(
            "Only administrators can create catalog records"
        )
    try:
        batch = _batch(session, batch_id, actor, lock=True)
        if not payload.confirm:
            raise ImportCatalogConflictError(
                "IMPORT_CATALOG_CONFIRMATION_REQUIRED",
                "Explicitly confirm creation of the proposed catalog records.",
            )
        _, existing = _plan(session, batch)
        # Share the parent row lock used by the ordinary category-create
        # service. Lock in a consistent order across multi-category imports.
        parent_ids = sorted({parent.id for parent in existing.values()})
        if parent_ids:
            session.exec(
                select(Certification)
                .where(Certification.id.in_(parent_ids))
                .order_by(Certification.id)
                .with_for_update()
            ).all()
        plan, existing = _plan(session, batch)
        if plan.plan_id != payload.plan_id:
            raise ImportCatalogConflictError(
                "IMPORT_CATALOG_PLAN_CHANGED",
                "The catalog or validation state has changed. Review the updated plan before confirming.",
            )
        if not plan.can_confirm:
            raise ImportCatalogConflictError(
                "IMPORT_CATALOG_NOT_AVAILABLE",
                "There are no resolvable missing records, or workbook references need correction.",
            )
        codes = [item.code for item in payload.certifications]
        expected_codes = {item.code for item in plan.missing_certifications}
        if len(codes) != len(set(codes)) or set(codes) != expected_codes:
            raise ImportCatalogConflictError(
                "IMPORT_CATALOG_CONFIGURATION_MISMATCH",
                "Supply configuration for each proposed new certification, and no others.",
            )
        new_certifications: list[UUID] = []
        new_categories: list[UUID] = []
        for item in sorted(payload.certifications, key=lambda config: config.code):
            certification = Certification(
                code=item.code,
                name=item.name,
                passing_threshold_pct=item.passing_threshold_pct,
                feedback_mode=item.feedback_mode,
                is_published=False,
            )
            session.add(certification)
            existing[item.code] = certification
            new_certifications.append(certification.id)
        session.flush()
        for item in plan.missing_categories:
            category = Category(
                certification_id=existing[item.certification_code].id,
                name=item.name,
                is_published=False,
            )
            session.add(category)
            new_categories.append(category.id)
        session.flush()
        # Existing validator commits the refreshed row/batch state. Because
        # all catalog inserts are only flushed, its commit also commits those
        # inserts, or a failure rolls back the entire operation.
        validate_question_import_batch(session, batch_id=batch_id)
        return CatalogResolution(batch_id, new_certifications, new_categories)
    except IntegrityError as exc:
        session.rollback()
        raise ImportCatalogConflictError(
            "IMPORT_CATALOG_PLAN_CHANGED",
            "Catalog records changed while confirming. Refresh the preview and try again.",
        ) from exc
    except Exception:
        session.rollback()
        raise
