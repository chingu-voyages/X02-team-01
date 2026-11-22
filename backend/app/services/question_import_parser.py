"""Question-bank XLSX parsing and image-filename matching for JHEP-118."""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from datetime import date, datetime, time
from io import BytesIO
from pathlib import PurePath
from zipfile import BadZipFile, ZipFile

from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

from app.models.question_import_asset import QuestionImportAsset

IMPORT_TEMPLATE_VERSION = "2.0"

QUESTIONS_SHEET = "Questions"

QUESTION_IMPORT_HEADERS = (
    "template_version",
    "certification_code",
    "category_name",
    "difficulty",
    "question_type",
    "allows_multiple_answers",
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

MAX_WORKBOOK_BYTES = 5 * 1024 * 1024
MAX_QUESTION_ROWS = 1_000

# Preflight OOXML limits. These protect the parser from oversized ZIP packages
# before openpyxl expands workbook XML in memory.
MAX_PACKAGE_ENTRIES = 512
MAX_PACKAGE_UNCOMPRESSED_BYTES = 50 * 1024 * 1024
MAX_PACKAGE_ENTRY_BYTES = 20 * 1024 * 1024


class QuestionImportParseError(ValueError):
    """Stable workbook/asset parse error that later becomes a preview issue."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        sheet: str | None = None,
        row: int | None = None,
        field: str | None = None,
        cell: str | None = None,
    ) -> None:
        super().__init__(message)

        self.code = code
        self.message = message
        self.sheet = sheet
        self.row = row
        self.field = field
        self.cell = cell


@dataclass(frozen=True)
class ParsedQuestionRow:
    """One nonblank physical Questions-sheet row."""

    row_number: int
    values: dict[str, object]


@dataclass(frozen=True)
class ParsedQuestionWorkbook:
    """Validated workbook structure and raw question rows."""

    template_version: str
    original_filename: str
    headers: tuple[str, ...]
    rows: tuple[ParsedQuestionRow, ...]


def parse_question_bank_workbook(
    *,
    filename: str,
    content: bytes,
) -> ParsedQuestionWorkbook:
    """Parse one contract-v2 XLSX without touching the database."""

    _validate_filename(filename)

    if len(content) > MAX_WORKBOOK_BYTES:
        raise QuestionImportParseError(
            "FILE_TOO_LARGE",
            (
                "Question-bank workbook exceeds the "
                f"{MAX_WORKBOOK_BYTES // (1024 * 1024)} MiB upload limit."
            ),
        )

    _preflight_ooxml_package(content)

    try:
        workbook = load_workbook(
            BytesIO(content),
            read_only=False,
            data_only=False,
            keep_links=True,
        )
    except Exception as exc:
        raise QuestionImportParseError(
            "MALFORMED_WORKBOOK",
            "The uploaded file is not a readable XLSX workbook.",
        ) from exc

    try:
        if QUESTIONS_SHEET not in workbook.sheetnames:
            raise QuestionImportParseError(
                "QUESTIONS_SHEET_MISSING",
                "Workbook must contain a visible worksheet named 'Questions'.",
            )

        worksheet = workbook[QUESTIONS_SHEET]

        if worksheet.sheet_state != "visible":
            raise QuestionImportParseError(
                "QUESTIONS_SHEET_HIDDEN",
                "The Questions worksheet must be visible.",
                sheet=QUESTIONS_SHEET,
            )

        _validate_questions_sheet_structure(worksheet)

        header_map = _read_header_map(worksheet)

        rows: list[ParsedQuestionRow] = []

        for row_number in range(2, worksheet.max_row + 1):
            if _row_is_blank(
                worksheet,
                row_number=row_number,
                header_map=header_map,
            ):
                continue

            if worksheet.row_dimensions[row_number].hidden:
                raise QuestionImportParseError(
                    "HIDDEN_DATA_ROW",
                    (
                        f"Questions row {row_number} is hidden. "
                        "Hidden import rows are not allowed."
                    ),
                    sheet=QUESTIONS_SHEET,
                    row=row_number,
                )

            values: dict[str, object] = {}

            for header, column_index in header_map.items():
                cell = worksheet.cell(
                    row=row_number,
                    column=column_index,
                )

                _validate_import_cell(
                    cell,
                    field=header,
                    row_number=row_number,
                )

                values[header] = _json_safe_cell_value(cell.value)

            rows.append(
                ParsedQuestionRow(
                    row_number=row_number,
                    values=values,
                )
            )

            if len(rows) > MAX_QUESTION_ROWS:
                raise QuestionImportParseError(
                    "TOO_MANY_ROWS",
                    (
                        "Question-bank workbook exceeds the "
                        f"{MAX_QUESTION_ROWS} question-row limit."
                    ),
                    sheet=QUESTIONS_SHEET,
                )

        if not rows:
            raise QuestionImportParseError(
                "EMPTY_IMPORT",
                "The Questions worksheet does not contain any question rows.",
                sheet=QUESTIONS_SHEET,
            )

        return ParsedQuestionWorkbook(
            template_version=IMPORT_TEMPLATE_VERSION,
            original_filename=filename,
            headers=tuple(header_map),
            rows=tuple(rows),
        )

    finally:
        workbook.close()


def normalize_import_image_filename(
    value: str,
) -> str:
    """Normalize one author-supplied image basename for matching."""

    normalized = unicodedata.normalize(
        "NFC",
        value.strip(),
    )

    if not normalized:
        raise QuestionImportParseError(
            "IMAGE_FILENAME_BLANK",
            "Image filename must not be blank.",
            field="image_filename",
        )

    if "/" in normalized or "\\" in normalized:
        raise QuestionImportParseError(
            "IMAGE_PATH_NOT_ALLOWED",
            "Image references must contain a filename only, not a path.",
            field="image_filename",
        )

    if PurePath(normalized).name != normalized:
        raise QuestionImportParseError(
            "IMAGE_PATH_NOT_ALLOWED",
            "Image references must contain a filename only, not a path.",
            field="image_filename",
        )

    if normalized in {".", ".."}:
        raise QuestionImportParseError(
            "INVALID_IMAGE_FILENAME",
            "Image filename is invalid.",
            field="image_filename",
        )

    return normalized.casefold()


def build_import_asset_lookup(
    assets: list[QuestionImportAsset],
) -> dict[str, QuestionImportAsset]:
    """Build a normalized filename lookup and reject ambiguous filenames."""

    lookup: dict[str, QuestionImportAsset] = {}

    for asset in assets:
        normalized = normalize_import_image_filename(asset.source_filename)

        existing = lookup.get(normalized)

        if existing is not None:
            raise QuestionImportParseError(
                "DUPLICATE_IMAGE_FILENAME",
                (
                    "Multiple uploaded image files normalize to the same "
                    f"filename: {asset.source_filename!r}."
                ),
                field="image_filename",
            )

        lookup[normalized] = asset

    return lookup


def match_import_asset(
    *,
    image_filename: str,
    asset_lookup: dict[str, QuestionImportAsset],
) -> QuestionImportAsset | None:
    """Return the staged asset matching one workbook image filename."""

    normalized = normalize_import_image_filename(image_filename)

    return asset_lookup.get(normalized)


def _validate_filename(
    filename: str,
) -> None:
    normalized = filename.strip()

    if not normalized.lower().endswith(".xlsx"):
        raise QuestionImportParseError(
            "UNSUPPORTED_FILE_TYPE",
            "Question-bank imports must use the .xlsx template.",
        )


def _preflight_ooxml_package(
    content: bytes,
) -> None:
    try:
        with ZipFile(BytesIO(content)) as package:
            entries = package.infolist()

            if len(entries) > MAX_PACKAGE_ENTRIES:
                raise QuestionImportParseError(
                    "PACKAGE_TOO_COMPLEX",
                    "Workbook package contains too many internal files.",
                )

            total_uncompressed = 0

            for entry in entries:
                if entry.flag_bits & 0x1:
                    raise QuestionImportParseError(
                        "ENCRYPTED_WORKBOOK",
                        "Encrypted/password-protected workbooks are not supported.",
                    )

                if entry.file_size > MAX_PACKAGE_ENTRY_BYTES:
                    raise QuestionImportParseError(
                        "PACKAGE_ENTRY_TOO_LARGE",
                        "Workbook contains an internal file that is too large.",
                    )

                total_uncompressed += entry.file_size

                if total_uncompressed > MAX_PACKAGE_UNCOMPRESSED_BYTES:
                    raise QuestionImportParseError(
                        "PACKAGE_TOO_LARGE",
                        "Workbook expands beyond the safe parsing limit.",
                    )

                normalized_name = entry.filename.replace("\\", "/")
                lowered = normalized_name.lower()

                if "../" in normalized_name or normalized_name.startswith("/"):
                    raise QuestionImportParseError(
                        "UNSAFE_PACKAGE_PATH",
                        "Workbook contains an unsafe internal package path.",
                    )

                if lowered == "xl/vbaproject.bin":
                    raise QuestionImportParseError(
                        "MACROS_NOT_ALLOWED",
                        "Macro-enabled workbooks are not supported.",
                    )

                if (
                    lowered.startswith("xl/media/")
                    or lowered.startswith("xl/embeddings/")
                    or lowered.startswith("xl/drawings/")
                ):
                    raise QuestionImportParseError(
                        "EMBEDDED_MEDIA_NOT_ALLOWED",
                        (
                            "Images or embedded objects must not be placed "
                            "inside the workbook."
                        ),
                    )

                if (
                    lowered.startswith("xl/externallinks/")
                    or lowered == "xl/connections.xml"
                ):
                    raise QuestionImportParseError(
                        "EXTERNAL_LINKS_NOT_ALLOWED",
                        (
                            "External workbook links or data connections "
                            "are not supported."
                        ),
                    )

    except QuestionImportParseError:
        raise
    except BadZipFile as exc:
        raise QuestionImportParseError(
            "MALFORMED_WORKBOOK",
            "The uploaded file is not a valid XLSX package.",
        ) from exc


def _validate_questions_sheet_structure(
    worksheet,
) -> None:
    if worksheet.merged_cells.ranges:
        raise QuestionImportParseError(
            "MERGED_CELLS_NOT_ALLOWED",
            "Merged cells are not allowed in the Questions worksheet.",
            sheet=QUESTIONS_SHEET,
        )

    active_filter_columns = getattr(
        worksheet.auto_filter,
        "filterColumn",
        (),
    )
    sort_state = getattr(
        worksheet.auto_filter,
        "sortState",
        None,
    )

    if active_filter_columns or sort_state is not None:
        raise QuestionImportParseError(
            "ACTIVE_FILTER_NOT_ALLOWED",
            (
                "Remove active filters/sorts from the Questions worksheet "
                "before importing."
            ),
            sheet=QUESTIONS_SHEET,
        )


def _read_header_map(
    worksheet,
) -> dict[str, int]:
    header_cells = [
        worksheet.cell(
            row=1,
            column=column_index,
        )
        for column_index in range(
            1,
            max(
                worksheet.max_column,
                len(QUESTION_IMPORT_HEADERS),
            )
            + 1,
        )
    ]

    seen: dict[str, int] = {}
    duplicates: list[str] = []
    unknown: list[str] = []

    for cell in header_cells:
        value = cell.value

        if value is None:
            continue

        header = str(value)

        if not header.strip():
            continue

        if header in seen:
            duplicates.append(header)
            continue

        seen[header] = cell.column

        if header not in QUESTION_IMPORT_HEADERS:
            unknown.append(header)

    if duplicates:
        raise QuestionImportParseError(
            "DUPLICATE_HEADER",
            (
                "Questions worksheet contains duplicate headers: "
                + ", ".join(sorted(set(duplicates)))
            ),
            sheet=QUESTIONS_SHEET,
            row=1,
        )

    if unknown:
        raise QuestionImportParseError(
            "UNKNOWN_HEADER",
            (
                "Questions worksheet contains unsupported headers: "
                + ", ".join(sorted(unknown))
            ),
            sheet=QUESTIONS_SHEET,
            row=1,
        )

    missing = [header for header in QUESTION_IMPORT_HEADERS if header not in seen]

    if missing:
        raise QuestionImportParseError(
            "MISSING_HEADER",
            ("Questions worksheet is missing required headers: " + ", ".join(missing)),
            sheet=QUESTIONS_SHEET,
            row=1,
        )

    for header, column_index in seen.items():
        column_letter = get_column_letter(column_index)

        if worksheet.column_dimensions[column_letter].hidden:
            raise QuestionImportParseError(
                "HIDDEN_IMPORT_COLUMN",
                (
                    f"Import column {column_letter} ({header}) is hidden. "
                    "Hidden import columns are not allowed."
                ),
                sheet=QUESTIONS_SHEET,
                row=1,
                field=header,
                cell=f"{column_letter}1",
            )

    _reject_data_outside_headers(
        worksheet,
        known_columns=set(seen.values()),
    )

    return {header: seen[header] for header in QUESTION_IMPORT_HEADERS}


def _reject_data_outside_headers(
    worksheet,
    *,
    known_columns: set[int],
) -> None:
    for column_index in range(
        1,
        worksheet.max_column + 1,
    ):
        if column_index in known_columns:
            continue

        for row_number in range(
            2,
            worksheet.max_row + 1,
        ):
            cell = worksheet.cell(
                row=row_number,
                column=column_index,
            )

            if not _is_blank_value(cell.value):
                raise QuestionImportParseError(
                    "DATA_OUTSIDE_CONTRACT_COLUMNS",
                    (
                        "Questions worksheet contains data under a column "
                        "that is not part of the import contract."
                    ),
                    sheet=QUESTIONS_SHEET,
                    row=row_number,
                    cell=cell.coordinate,
                )


def _row_is_blank(
    worksheet,
    *,
    row_number: int,
    header_map: dict[str, int],
) -> bool:
    return all(
        _is_blank_value(
            worksheet.cell(
                row=row_number,
                column=column_index,
            ).value
        )
        for column_index in header_map.values()
    )


def _validate_import_cell(
    cell,
    *,
    field: str,
    row_number: int,
) -> None:
    if cell.data_type == "f":
        raise QuestionImportParseError(
            "FORMULA_NOT_ALLOWED",
            (
                f"Formula found in {cell.coordinate}. "
                "Imported cells must contain literal values."
            ),
            sheet=QUESTIONS_SHEET,
            row=row_number,
            field=field,
            cell=cell.coordinate,
        )

    if cell.data_type == "e":
        raise QuestionImportParseError(
            "CELL_ERROR_NOT_ALLOWED",
            f"Excel error value found in {cell.coordinate}.",
            sheet=QUESTIONS_SHEET,
            row=row_number,
            field=field,
            cell=cell.coordinate,
        )

    if isinstance(
        cell.value,
        (datetime, date, time),
    ):
        raise QuestionImportParseError(
            "UNSUPPORTED_CELL_TYPE",
            (
                f"Date/time value found in {cell.coordinate}. "
                "Use plain text values in the import template."
            ),
            sheet=QUESTIONS_SHEET,
            row=row_number,
            field=field,
            cell=cell.coordinate,
        )


def _json_safe_cell_value(
    value: object,
) -> object:
    if value is None:
        return None

    if isinstance(
        value,
        (
            str,
            bool,
            int,
            float,
        ),
    ):
        return value

    return str(value)


def _is_blank_value(
    value: object,
) -> bool:
    if value is None:
        return True

    if isinstance(value, str):
        return not value.strip()

    return False
