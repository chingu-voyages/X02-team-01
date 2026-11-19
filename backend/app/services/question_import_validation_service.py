"""Validation engine for staged JHEP-118 question imports."""

from __future__ import annotations

import json
import unicodedata
from dataclasses import dataclass
from hashlib import sha256
from uuid import UUID

from pydantic import ValidationError
from sqlmodel import Session, select

from app.models.category import Category
from app.models.certification import Certification
from app.models.question import Question
from app.models.question_import_asset import QuestionImportAsset
from app.models.question_import_batch import QuestionImportBatch
from app.models.question_import_row import QuestionImportRow
from app.models.question_version import QuestionVersion
from app.schemas.admin_question import QuestionDraftCreate
from app.services.question_image_validation import MAX_ALT_TEXT_LENGTH
from app.services.question_import_parser import (
    IMPORT_TEMPLATE_VERSION,
    QuestionImportParseError,
    normalize_import_image_filename,
)

OPTION_FIELDS = (
    ("A", "option_a"),
    ("B", "option_b"),
    ("C", "option_c"),
    ("D", "option_d"),
    ("E", "option_e"),
    ("F", "option_f"),
)

TEXT_FIELDS = (
    "template_version",
    "certification_code",
    "category_name",
    "difficulty",
    "question_type",
    "question_text",
    "option_a",
    "option_b",
    "option_c",
    "option_d",
    "option_e",
    "option_f",
    "correct_answers",
    "expected_answer",
    "explanation",
    "image_filename",
    "image_alt_text",
)

INLINE_MATH_OPEN = r"\("
INLINE_MATH_CLOSE = r"\)"
DISPLAY_MATH_OPEN = r"\["
DISPLAY_MATH_CLOSE = r"\]"


@dataclass(frozen=True)
class QuestionImportValidationResult:
    """One complete validation receipt for a staged batch."""

    batch_id: UUID
    total_rows: int
    valid_rows: int
    error_rows: int
    warning_rows: int
    can_import: bool
    unused_asset_filenames: tuple[str, ...]


def validate_question_import_batch(
    session: Session,
    *,
    batch_id: UUID,
) -> QuestionImportValidationResult:
    """Validate all staged rows and update batch/row validation state."""

    batch = session.get(
        QuestionImportBatch,
        batch_id,
    )

    if batch is None:
        raise LookupError("Question import batch not found")

    rows = list(
        session.exec(
            select(QuestionImportRow)
            .where(QuestionImportRow.batch_id == batch.id)
            .order_by(QuestionImportRow.row_number)
        ).all()
    )

    assets = list(
        session.exec(
            select(QuestionImportAsset)
            .where(QuestionImportAsset.batch_id == batch.id)
            .order_by(QuestionImportAsset.source_filename)
        ).all()
    )

    certifications = list(session.exec(select(Certification)).all())

    categories = list(session.exec(select(Category)).all())

    certification_by_code = {
        certification.code.strip(): certification for certification in certifications
    }

    categories_by_certification: dict[
        UUID,
        list[Category],
    ] = {}

    for category in categories:
        categories_by_certification.setdefault(
            category.certification_id,
            [],
        ).append(category)

    asset_lookup = _asset_lookup(assets)

    existing_fingerprints = _existing_question_fingerprints(session)

    candidate_fingerprints: dict[
        str,
        list[QuestionImportRow],
    ] = {}

    used_asset_ids: set[UUID] = set()

    batch.status = "validating"
    batch.failure_message = None

    for row in rows:
        row.status = "pending"
        row.normalized_payload = None
        row.validation_issues = []
        row.content_fingerprint = None
        row.duplicate_question_id = None
        row.matched_asset_id = None

        issues: list[dict[str, object]] = []

        normalized = _normalize_raw_payload(
            row.raw_payload,
            row_number=(row.row_number),
            issues=issues,
        )

        candidate = _validate_row_candidate(
            normalized,
            row_number=(row.row_number),
            issues=issues,
            certification_by_code=(certification_by_code),
            categories_by_certification=(categories_by_certification),
            asset_lookup=(asset_lookup),
        )

        if candidate is not None:
            row.normalized_payload = candidate["normalized_payload"]
            row.content_fingerprint = candidate["content_fingerprint"]

            matched_asset_id = candidate["matched_asset_id"]

            if matched_asset_id is not None:
                row.matched_asset_id = matched_asset_id
                used_asset_ids.add(matched_asset_id)

            candidate_fingerprints.setdefault(
                row.content_fingerprint,
                [],
            ).append(row)

            duplicate_question_id = existing_fingerprints.get(row.content_fingerprint)

            if duplicate_question_id is not None:
                row.duplicate_question_id = duplicate_question_id
                issues.append(
                    _issue(
                        row=(row.row_number),
                        field=("question_text"),
                        severity=("error"),
                        code=("DUPLICATE_IN_BANK"),
                        message=(
                            "A question with the same certification, "
                            "category, type, and normalized text already "
                            "exists in the question bank."
                        ),
                    )
                )

        row.validation_issues = issues

    _apply_in_file_duplicates(candidate_fingerprints)

    valid_rows = 0
    error_rows = 0
    warning_rows = 0

    for row in rows:
        issues = list(row.validation_issues)

        has_error = any(issue["severity"] == "error" for issue in issues)

        has_warning = any(issue["severity"] == "warning" for issue in issues)

        row.status = "invalid" if has_error else "valid"

        if has_error:
            error_rows += 1
        else:
            valid_rows += 1

        if has_warning:
            warning_rows += 1

        session.add(row)

    unused_asset_filenames = tuple(
        asset.source_filename
        for asset in assets
        if (asset.status == "valid" and asset.id not in used_asset_ids)
    )

    batch.total_rows = len(rows)
    batch.valid_rows = valid_rows
    batch.error_rows = error_rows
    batch.warning_rows = warning_rows + len(unused_asset_filenames)

    batch.status = "ready" if error_rows == 0 else "invalid"

    session.add(batch)
    session.commit()

    return QuestionImportValidationResult(
        batch_id=batch.id,
        total_rows=len(rows),
        valid_rows=valid_rows,
        error_rows=error_rows,
        warning_rows=(batch.warning_rows),
        can_import=(error_rows == 0),
        unused_asset_filenames=(unused_asset_filenames),
    )


def normalize_import_text(
    value: object,
) -> str | None:
    """Normalize one workbook textual value under contract-v2 rules."""

    if value is None:
        return None

    if isinstance(value, bool):
        text_value = "true" if value else "false"
    else:
        text_value = str(value)

    normalized = (
        unicodedata.normalize(
            "NFC",
            text_value,
        )
        .replace(
            "\r\n",
            "\n",
        )
        .replace(
            "\r",
            "\n",
        )
        .strip()
    )

    if not normalized:
        return None

    for character in normalized:
        codepoint = ord(character)

        if codepoint < 32 and character not in {
            "\n",
            "\t",
        }:
            raise ValueError("Text contains unsupported control characters")

    return normalized


def question_content_fingerprint(
    *,
    certification_id: UUID,
    category_id: UUID | None,
    question_type: str,
    question_text: str,
) -> str:
    """Create the exact deterministic duplicate key from contract v2."""

    material = {
        "certification_id": str(certification_id),
        "category_id": (str(category_id) if category_id is not None else None),
        "question_type": (question_type),
        "question_text": (normalize_import_text(question_text) or ""),
    }

    encoded = json.dumps(
        material,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")

    return sha256(encoded).hexdigest()


def _normalize_raw_payload(
    raw_payload: dict[
        str,
        object,
    ],
    *,
    row_number: int,
    issues: list[dict[str, object]],
) -> dict[
    str,
    object,
]:
    normalized: dict[
        str,
        object,
    ] = {}

    for field in TEXT_FIELDS:
        value = raw_payload.get(field)

        try:
            normalized[field] = normalize_import_text(value)

        except ValueError:
            normalized[field] = None

            issues.append(
                _issue(
                    row=row_number,
                    field=field,
                    severity=("error"),
                    code=("INVALID_CONTROL_CHARACTER"),
                    message=("Field contains an unsupported control character."),
                )
            )

    normalized["allows_multiple_answers"] = _normalize_boolean(
        raw_payload.get("allows_multiple_answers"),
        row_number=row_number,
        issues=issues,
    )

    return normalized


def _validate_row_candidate(
    normalized: dict[
        str,
        object,
    ],
    *,
    row_number: int,
    issues: list[dict[str, object]],
    certification_by_code: dict[
        str,
        Certification,
    ],
    categories_by_certification: dict[
        UUID,
        list[Category],
    ],
    asset_lookup: dict[
        str,
        QuestionImportAsset,
    ],
) -> (
    dict[
        str,
        object,
    ]
    | None
):
    template_version = normalized.get("template_version")

    if template_version != IMPORT_TEMPLATE_VERSION:
        issues.append(
            _issue(
                row=row_number,
                field=("template_version"),
                severity="error",
                code=("UNSUPPORTED_TEMPLATE_VERSION"),
                message=(
                    f"template_version must be exactly {IMPORT_TEMPLATE_VERSION}."
                ),
            )
        )

    certification_code = normalized.get("certification_code")

    certification = None

    if not certification_code:
        issues.append(
            _required_issue(
                row_number,
                "certification_code",
            )
        )
    else:
        certification = certification_by_code.get(str(certification_code))

        if certification is None:
            issues.append(
                _issue(
                    row=row_number,
                    field=("certification_code"),
                    severity="error",
                    code=("CERTIFICATION_NOT_FOUND"),
                    message=(
                        "Certification code does not match an existing certification."
                    ),
                )
            )

    category = None
    category_name = normalized.get("category_name")

    if certification is not None:
        if not category_name:
            issues.append(
                _issue(
                    row=row_number,
                    field=("category_name"),
                    severity=("warning"),
                    code=("CATEGORY_MISSING"),
                    message=(
                        "Question has no category. It can be imported, "
                        "but category-based learner workflows may not include it."
                    ),
                )
            )
        else:
            matches = [
                item
                for item in (
                    categories_by_certification.get(
                        certification.id,
                        [],
                    )
                )
                if (item.name.strip().casefold() == str(category_name).casefold())
            ]

            if not matches:
                issues.append(
                    _issue(
                        row=row_number,
                        field=("category_name"),
                        severity=("error"),
                        code=("CATEGORY_NOT_FOUND"),
                        message=(
                            "Category does not exist under the selected certification."
                        ),
                    )
                )

            elif len(matches) > 1:
                issues.append(
                    _issue(
                        row=row_number,
                        field=("category_name"),
                        severity=("error"),
                        code=("AMBIGUOUS_CATALOG_REFERENCE"),
                        message=("Category name matches more than one category."),
                    )
                )

            else:
                category = matches[0]

    if certification is not None and (
        not certification.is_published
        or (category is not None and not category.is_published)
    ):
        issues.append(
            _issue(
                row=row_number,
                field=None,
                severity="warning",
                code=("CATALOG_UNPUBLISHED"),
                message=(
                    "Question references unpublished certification/category content."
                ),
            )
        )

    difficulty = normalized.get("difficulty")

    if not difficulty:
        issues.append(
            _required_issue(
                row_number,
                "difficulty",
            )
        )

    question_type = normalized.get("question_type")

    if not question_type:
        issues.append(
            _required_issue(
                row_number,
                "question_type",
            )
        )

    question_text = normalized.get("question_text")

    if not question_text:
        issues.append(
            _required_issue(
                row_number,
                "question_text",
            )
        )
    else:
        _validate_math(
            str(question_text),
            row_number=(row_number),
            issues=issues,
        )

    explanation = normalized.get("explanation")

    if not explanation:
        issues.append(
            _issue(
                row=row_number,
                field="explanation",
                severity="warning",
                code=("EXPLANATION_MISSING"),
                message=("Question has no learner explanation."),
            )
        )

    answer_payload = _answer_payload(
        normalized,
        row_number=row_number,
        issues=issues,
    )

    matched_asset_id = _validate_image_reference(
        normalized,
        row_number=row_number,
        issues=issues,
        asset_lookup=(asset_lookup),
    )

    if (
        certification is None
        or difficulty is None
        or question_type is None
        or question_text is None
        or answer_payload is None
    ):
        return None

    draft_payload = {
        "certification_id": (certification.id),
        "category_id": (category.id if category is not None else None),
        "difficulty": difficulty,
        "question_text": (question_text),
        "question_type": (question_type),
        "allows_multiple_answers": (normalized.get("allows_multiple_answers")),
        "explanation": (explanation),
        "options": (answer_payload["options"]),
        "expected_answer": (answer_payload["expected_answer"]),
    }

    try:
        validated = QuestionDraftCreate.model_validate(draft_payload)

    except ValidationError as exc:
        for error in exc.errors():
            location = error.get("loc") or ()

            field = str(location[0]) if location else None

            issues.append(
                _issue(
                    row=(row_number),
                    field=field,
                    severity=("error"),
                    code=("QUESTION_VALIDATION_ERROR"),
                    message=str(
                        error.get(
                            "msg",
                            "Question data is invalid.",
                        )
                    ),
                )
            )

        return None

    if validated.question_type == "short_answer":
        issues.append(
            _issue(
                row=row_number,
                field=("expected_answer"),
                severity=("warning"),
                code=("SHORT_ANSWER_NOT_AUTO_GRADED"),
                message=(
                    "Short-answer grading follows the application's existing "
                    "manual/non-MCQ grading behavior."
                ),
            )
        )

    normalized_payload = validated.model_dump(mode="json")

    normalized_payload["image_filename"] = normalized.get("image_filename")

    normalized_payload["image_alt_text"] = normalized.get("image_alt_text")

    fingerprint = question_content_fingerprint(
        certification_id=(certification.id),
        category_id=(category.id if category is not None else None),
        question_type=(validated.question_type),
        question_text=(validated.question_text),
    )

    return {
        "normalized_payload": (normalized_payload),
        "content_fingerprint": (fingerprint),
        "matched_asset_id": (matched_asset_id),
    }


def _answer_payload(
    normalized: dict[
        str,
        object,
    ],
    *,
    row_number: int,
    issues: list[dict[str, object]],
) -> (
    dict[
        str,
        object,
    ]
    | None
):
    question_type = normalized.get("question_type")

    if question_type == "multiple_choice":
        option_values = [
            (
                letter,
                field,
                normalized.get(field),
            )
            for (
                letter,
                field,
            ) in OPTION_FIELDS
        ]

        gap_seen = False
        provided_options: list[
            tuple[
                str,
                str,
            ]
        ] = []

        for (
            letter,
            field,
            value,
        ) in option_values:
            if not value:
                gap_seen = True
                continue

            if gap_seen:
                issues.append(
                    _issue(
                        row=(row_number),
                        field=field,
                        severity=("error"),
                        code=("OPTION_GAP"),
                        message=(
                            "Multiple-choice options must be contiguous from option A."
                        ),
                    )
                )

            provided_options.append(
                (
                    letter,
                    str(value),
                )
            )

        normalized_option_values = [value.casefold() for _, value in provided_options]

        if len(normalized_option_values) != len(set(normalized_option_values)):
            issues.append(
                _issue(
                    row=row_number,
                    field=None,
                    severity="error",
                    code=("DUPLICATE_OPTION_TEXT"),
                    message=(
                        "Multiple-choice options must not contain duplicate text."
                    ),
                )
            )

        correct_answers = _correct_answer_letters(
            normalized.get("correct_answers"),
            row_number=(row_number),
            issues=issues,
        )

        supplied_letters = {letter for letter, _ in provided_options}

        for letter in correct_answers:
            if letter not in supplied_letters:
                issues.append(
                    _issue(
                        row=(row_number),
                        field=("correct_answers"),
                        severity=("error"),
                        code=("INVALID_ANSWER_REFERENCE"),
                        message=(
                            f"Correct answer {letter} does not reference a supplied option."
                        ),
                    )
                )

        if normalized.get("expected_answer") is not None:
            issues.append(
                _issue(
                    row=row_number,
                    field=("expected_answer"),
                    severity="error",
                    code=("EXPECTED_ANSWER_NOT_ALLOWED"),
                    message=(
                        "Multiple-choice questions must leave expected_answer blank."
                    ),
                )
            )

        return {
            "options": [
                {
                    "option_text": (value),
                    "is_correct": (letter in correct_answers),
                }
                for (
                    letter,
                    value,
                ) in provided_options
            ],
            "expected_answer": None,
        }

    if question_type == "short_answer":
        for (
            _letter,
            field,
        ) in OPTION_FIELDS:
            if normalized.get(field):
                issues.append(
                    _issue(
                        row=(row_number),
                        field=field,
                        severity=("error"),
                        code=("OPTIONS_NOT_ALLOWED"),
                        message=(
                            "Short-answer questions must leave option columns blank."
                        ),
                    )
                )

        if normalized.get("correct_answers"):
            issues.append(
                _issue(
                    row=row_number,
                    field=("correct_answers"),
                    severity="error",
                    code=("CORRECT_ANSWERS_NOT_ALLOWED"),
                    message=(
                        "Short-answer questions must leave correct_answers blank."
                    ),
                )
            )

        expected_answer = normalized.get("expected_answer")

        if not expected_answer:
            issues.append(
                _required_issue(
                    row_number,
                    "expected_answer",
                )
            )

        return {
            "options": [],
            "expected_answer": (expected_answer),
        }

    return None


def _correct_answer_letters(
    value: object,
    *,
    row_number: int,
    issues: list[dict[str, object]],
) -> list[str]:
    if value is None:
        return []

    raw_letters = [
        item.strip().upper() for item in str(value).split(";") if item.strip()
    ]

    if len(raw_letters) != len(set(raw_letters)):
        issues.append(
            _issue(
                row=row_number,
                field=("correct_answers"),
                severity="error",
                code=("DUPLICATE_ANSWER_REFERENCE"),
                message=(
                    "correct_answers contains the same answer letter more than once."
                ),
            )
        )

    valid_letters = {letter for letter, _ in OPTION_FIELDS}

    for letter in raw_letters:
        if letter not in valid_letters:
            issues.append(
                _issue(
                    row=row_number,
                    field=("correct_answers"),
                    severity="error",
                    code=("INVALID_ANSWER_REFERENCE"),
                    message=(f"Unsupported correct answer reference: {letter}."),
                )
            )

    return raw_letters


def _normalize_boolean(
    value: object,
    *,
    row_number: int,
    issues: list[dict[str, object]],
) -> bool | None:
    if isinstance(
        value,
        bool,
    ):
        return value

    normalized = normalize_import_text(value)

    if normalized is None:
        issues.append(
            _required_issue(
                row_number,
                "allows_multiple_answers",
            )
        )
        return None

    lowered = normalized.casefold()

    if lowered == "true":
        return True

    if lowered == "false":
        return False

    issues.append(
        _issue(
            row=row_number,
            field=("allows_multiple_answers"),
            severity="error",
            code=("INVALID_BOOLEAN"),
            message=("allows_multiple_answers must be true or false."),
        )
    )

    return None


def _validate_image_reference(
    normalized: dict[
        str,
        object,
    ],
    *,
    row_number: int,
    issues: list[dict[str, object]],
    asset_lookup: dict[
        str,
        QuestionImportAsset,
    ],
) -> UUID | None:
    image_filename = normalized.get("image_filename")

    image_alt_text = normalized.get("image_alt_text")

    if not image_filename and not image_alt_text:
        return None

    if image_filename and not image_alt_text:
        issues.append(
            _issue(
                row=row_number,
                field=("image_alt_text"),
                severity="error",
                code=("IMAGE_ALT_TEXT_REQUIRED"),
                message=("image_alt_text is required when image_filename is supplied."),
            )
        )

    if image_alt_text and not image_filename:
        issues.append(
            _issue(
                row=row_number,
                field=("image_alt_text"),
                severity="error",
                code=("IMAGE_ALT_TEXT_WITHOUT_IMAGE"),
                message=("image_alt_text must be blank when image_filename is blank."),
            )
        )

        return None

    if image_alt_text and len(str(image_alt_text)) > MAX_ALT_TEXT_LENGTH:
        issues.append(
            _issue(
                row=row_number,
                field=("image_alt_text"),
                severity="error",
                code=("IMAGE_ALT_TEXT_TOO_LONG"),
                message=(
                    f"Image alt text must not exceed {MAX_ALT_TEXT_LENGTH} characters."
                ),
            )
        )

    if not image_filename:
        return None

    try:
        normalized_filename = normalize_import_image_filename(str(image_filename))
    except QuestionImportParseError as exc:
        issues.append(
            _issue(
                row=row_number,
                field=("image_filename"),
                severity="error",
                code=exc.code,
                message=exc.message,
            )
        )
        return None

    asset = asset_lookup.get(normalized_filename)

    if asset is None:
        issues.append(
            _issue(
                row=row_number,
                field=("image_filename"),
                severity="error",
                code=("MISSING_IMAGE_FILE"),
                message=(
                    "Referenced image file has not been supplied to this import batch."
                ),
                asset_filename=(str(image_filename)),
            )
        )
        return None

    if asset.status != "valid":
        issues.append(
            _issue(
                row=row_number,
                field=("image_filename"),
                severity="error",
                code=("INVALID_IMAGE_FILE"),
                message=("Referenced image file has not passed image validation."),
                asset_filename=(asset.source_filename),
            )
        )
        return None

    return asset.id


def _asset_lookup(
    assets: list[QuestionImportAsset],
) -> dict[
    str,
    QuestionImportAsset,
]:
    lookup: dict[
        str,
        QuestionImportAsset,
    ] = {}

    for asset in assets:
        normalized = normalize_import_image_filename(asset.source_filename)

        lookup[normalized] = asset

    return lookup


def _existing_question_fingerprints(
    session: Session,
) -> dict[
    str,
    UUID,
]:
    rows = session.exec(
        select(
            Question,
            QuestionVersion,
        ).join(
            QuestionVersion,
            QuestionVersion.question_id == Question.id,
        )
    ).all()

    fingerprints: dict[
        str,
        UUID,
    ] = {}

    for (
        question,
        version,
    ) in rows:
        fingerprint = question_content_fingerprint(
            certification_id=(question.certification_id),
            category_id=(question.category_id),
            question_type=(version.question_type),
            question_text=(version.question_text),
        )

        fingerprints.setdefault(
            fingerprint,
            question.id,
        )

    return fingerprints


def _apply_in_file_duplicates(
    candidate_fingerprints: dict[
        str,
        list[QuestionImportRow],
    ],
) -> None:
    for rows in candidate_fingerprints.values():
        if len(rows) < 2:
            continue

        related_rows = [row.row_number for row in rows]

        for row in rows:
            issues = list(row.validation_issues)

            issues.append(
                _issue(
                    row=(row.row_number),
                    field=("question_text"),
                    severity=("error"),
                    code=("DUPLICATE_IN_FILE"),
                    message=(
                        "Another row in this workbook has the same "
                        "certification, category, type, and normalized text."
                    ),
                    related_rows=(related_rows),
                )
            )

            row.validation_issues = issues


def _validate_math(
    question_text: str,
    *,
    row_number: int,
    issues: list[dict[str, object]],
) -> None:
    inline_open = question_text.count(INLINE_MATH_OPEN)
    inline_close = question_text.count(INLINE_MATH_CLOSE)
    display_open = question_text.count(DISPLAY_MATH_OPEN)
    display_close = question_text.count(DISPLAY_MATH_CLOSE)

    if inline_open != inline_close or display_open != display_close:
        issues.append(
            _issue(
                row=row_number,
                field=("question_text"),
                severity="error",
                code=("MATH_DELIMITER_MISMATCH"),
                message=(
                    "Math delimiters must use balanced \\( \\) and \\[ \\] pairs."
                ),
            )
        )
        return

    if inline_open or display_open:
        issues.append(
            _issue(
                row=row_number,
                field=("question_text"),
                severity=("warning"),
                code=("MATH_PREVIEW_RECOMMENDED"),
                message=(
                    "Review this math-bearing question in the visual import preview."
                ),
            )
        )


def _required_issue(
    row_number: int,
    field: str,
) -> dict[
    str,
    object,
]:
    return _issue(
        row=row_number,
        field=field,
        severity="error",
        code="REQUIRED_FIELD_MISSING",
        message=(f"{field} is required."),
    )


def _issue(
    *,
    row: int | None,
    field: str | None,
    severity: str,
    code: str,
    message: str,
    cell: str | None = None,
    value_preview: str | None = None,
    related_rows: list[int] | None = None,
    asset_filename: str | None = None,
) -> dict[
    str,
    object,
]:
    return {
        "sheet": "Questions" if row is not None else None,
        "row": row,
        "field": field,
        "cell": cell,
        "severity": severity,
        "code": code,
        "message": message,
        "value_preview": (value_preview),
        "related_rows": (related_rows or []),
        "asset_filename": (asset_filename),
    }
