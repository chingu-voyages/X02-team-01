from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

import pytest
from openpyxl import Workbook

from app.models.question_import_asset import QuestionImportAsset
from app.services.question_import_parser import (
    MAX_QUESTION_ROWS,
    MAX_WORKBOOK_BYTES,
    QUESTION_IMPORT_HEADERS,
    QuestionImportParseError,
    build_import_asset_lookup,
    match_import_asset,
    normalize_import_image_filename,
    parse_question_bank_workbook,
)


def workbook_bytes(
    *,
    headers: list[str] | None = None,
    rows: list[list[object]] | None = None,
    mutate=None,
) -> bytes:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "Questions"

    for name in [
        "Read Me",
        "Examples",
        "Field Guide",
        "Sources",
    ]:
        workbook.create_sheet(name)

    selected_headers = headers or list(QUESTION_IMPORT_HEADERS)

    for index, header in enumerate(
        selected_headers,
        start=1,
    ):
        worksheet.cell(
            row=1,
            column=index,
            value=header,
        )

    for row_index, row in enumerate(
        rows or [],
        start=2,
    ):
        for column_index, value in enumerate(
            row,
            start=1,
        ):
            worksheet.cell(
                row=row_index,
                column=column_index,
                value=value,
            )

    if mutate is not None:
        mutate(
            workbook,
            worksheet,
        )

    output = BytesIO()
    workbook.save(output)
    workbook.close()

    return output.getvalue()


def valid_row() -> list[object]:
    values = {
        "template_version": "2.0",
        "certification_code": "CLF-C02",
        "category_name": "Security",
        "difficulty": "medium",
        "question_type": "multiple_choice",
        "allows_multiple_answers": False,
        "question_text": "What is IAM?",
        "option_a": "Identity service",
        "option_b": "Object storage",
        "option_c": None,
        "option_d": None,
        "option_e": None,
        "option_f": None,
        "correct_answers": "A",
        "expected_answer": None,
        "explanation": "IAM manages identities and access.",
        "image_filename": "iam.png",
        "image_alt_text": "Identity and access diagram",
    }

    return [values[header] for header in QUESTION_IMPORT_HEADERS]


def test_parses_valid_contract_workbook():
    parsed = parse_question_bank_workbook(
        filename="questions.xlsx",
        content=workbook_bytes(
            rows=[valid_row()],
        ),
    )

    assert parsed.template_version == "2.0"
    assert parsed.original_filename == "questions.xlsx"
    assert parsed.headers == QUESTION_IMPORT_HEADERS
    assert len(parsed.rows) == 1
    assert parsed.rows[0].row_number == 2
    assert parsed.rows[0].values["question_text"] == "What is IAM?"


def test_column_order_may_vary():
    headers = list(reversed(QUESTION_IMPORT_HEADERS))

    values_by_header = dict(
        zip(
            QUESTION_IMPORT_HEADERS,
            valid_row(),
            strict=True,
        )
    )

    row = [values_by_header[header] for header in headers]

    parsed = parse_question_bank_workbook(
        filename="questions.XLSX",
        content=workbook_bytes(
            headers=headers,
            rows=[row],
        ),
    )

    assert parsed.rows[0].values["question_text"] == "What is IAM?"


@pytest.mark.parametrize(
    ("headers", "code"),
    [
        (
            list(QUESTION_IMPORT_HEADERS[:-1]),
            "MISSING_HEADER",
        ),
        (
            list(QUESTION_IMPORT_HEADERS) + [QUESTION_IMPORT_HEADERS[0]],
            "DUPLICATE_HEADER",
        ),
        (
            list(QUESTION_IMPORT_HEADERS) + ["unexpected"],
            "UNKNOWN_HEADER",
        ),
    ],
)
def test_rejects_invalid_headers(
    headers,
    code,
):
    with pytest.raises(QuestionImportParseError) as exc_info:
        parse_question_bank_workbook(
            filename="questions.xlsx",
            content=workbook_bytes(
                headers=headers,
                rows=[valid_row()],
            ),
        )

    assert exc_info.value.code == code


def test_rejects_header_only_workbook():
    with pytest.raises(QuestionImportParseError) as exc_info:
        parse_question_bank_workbook(
            filename="questions.xlsx",
            content=workbook_bytes(),
        )

    assert exc_info.value.code == "EMPTY_IMPORT"


def test_rejects_formula_cells():
    row = valid_row()

    question_index = QUESTION_IMPORT_HEADERS.index("question_text")
    row[question_index] = "=A1"

    with pytest.raises(QuestionImportParseError) as exc_info:
        parse_question_bank_workbook(
            filename="questions.xlsx",
            content=workbook_bytes(
                rows=[row],
            ),
        )

    assert exc_info.value.code == "FORMULA_NOT_ALLOWED"
    assert exc_info.value.row == 2


def test_rejects_merged_cells():
    def mutate(
        _workbook,
        worksheet,
    ):
        worksheet.merge_cells("A2:B2")

    with pytest.raises(QuestionImportParseError) as exc_info:
        parse_question_bank_workbook(
            filename="questions.xlsx",
            content=workbook_bytes(
                rows=[valid_row()],
                mutate=mutate,
            ),
        )

    assert exc_info.value.code == "MERGED_CELLS_NOT_ALLOWED"


def test_rejects_hidden_data_row():
    def mutate(
        _workbook,
        worksheet,
    ):
        worksheet.row_dimensions[2].hidden = True

    with pytest.raises(QuestionImportParseError) as exc_info:
        parse_question_bank_workbook(
            filename="questions.xlsx",
            content=workbook_bytes(
                rows=[valid_row()],
                mutate=mutate,
            ),
        )

    assert exc_info.value.code == "HIDDEN_DATA_ROW"


def test_rejects_hidden_import_column():
    def mutate(
        _workbook,
        worksheet,
    ):
        worksheet.column_dimensions["A"].hidden = True

    with pytest.raises(QuestionImportParseError) as exc_info:
        parse_question_bank_workbook(
            filename="questions.xlsx",
            content=workbook_bytes(
                rows=[valid_row()],
                mutate=mutate,
            ),
        )

    assert exc_info.value.code == "HIDDEN_IMPORT_COLUMN"


def test_rejects_active_filter():
    def mutate(
        _workbook,
        worksheet,
    ):
        worksheet.auto_filter.ref = "A1:R2"
        worksheet.auto_filter.add_filter_column(
            0,
            ["2.0"],
        )

    with pytest.raises(QuestionImportParseError) as exc_info:
        parse_question_bank_workbook(
            filename="questions.xlsx",
            content=workbook_bytes(
                rows=[valid_row()],
                mutate=mutate,
            ),
        )

    assert exc_info.value.code == "ACTIVE_FILTER_NOT_ALLOWED"


def test_rejects_data_outside_contract_columns():
    def mutate(
        _workbook,
        worksheet,
    ):
        worksheet.cell(
            row=2,
            column=19,
            value="unexpected data",
        )

    with pytest.raises(QuestionImportParseError) as exc_info:
        parse_question_bank_workbook(
            filename="questions.xlsx",
            content=workbook_bytes(
                rows=[valid_row()],
                mutate=mutate,
            ),
        )

    assert exc_info.value.code == "DATA_OUTSIDE_CONTRACT_COLUMNS"


def test_rejects_too_many_question_rows():
    rows = [valid_row() for _ in range(MAX_QUESTION_ROWS + 1)]

    with pytest.raises(QuestionImportParseError) as exc_info:
        parse_question_bank_workbook(
            filename="questions.xlsx",
            content=workbook_bytes(
                rows=rows,
            ),
        )

    assert exc_info.value.code == "TOO_MANY_ROWS"


def test_rejects_unsupported_extension():
    with pytest.raises(QuestionImportParseError) as exc_info:
        parse_question_bank_workbook(
            filename="questions.csv",
            content=b"not relevant",
        )

    assert exc_info.value.code == "UNSUPPORTED_FILE_TYPE"


def test_rejects_oversized_upload_before_parsing():
    with pytest.raises(QuestionImportParseError) as exc_info:
        parse_question_bank_workbook(
            filename="questions.xlsx",
            content=b"x" * (MAX_WORKBOOK_BYTES + 1),
        )

    assert exc_info.value.code == "FILE_TOO_LARGE"


@pytest.mark.parametrize(
    ("entry_name", "code"),
    [
        (
            "xl/media/image1.png",
            "EMBEDDED_MEDIA_NOT_ALLOWED",
        ),
        (
            "xl/embeddings/oleObject1.bin",
            "EMBEDDED_MEDIA_NOT_ALLOWED",
        ),
        (
            "xl/externalLinks/externalLink1.xml",
            "EXTERNAL_LINKS_NOT_ALLOWED",
        ),
        (
            "xl/connections.xml",
            "EXTERNAL_LINKS_NOT_ALLOWED",
        ),
        (
            "xl/vbaProject.bin",
            "MACROS_NOT_ALLOWED",
        ),
    ],
)
def test_rejects_unsafe_ooxml_parts(
    entry_name,
    code,
):
    original = workbook_bytes(
        rows=[valid_row()],
    )

    input_zip = ZipFile(BytesIO(original))
    output = BytesIO()

    with (
        input_zip,
        ZipFile(
            output,
            "w",
            ZIP_DEFLATED,
        ) as output_zip,
    ):
        for entry in input_zip.infolist():
            output_zip.writestr(
                entry,
                input_zip.read(entry.filename),
            )

        output_zip.writestr(
            entry_name,
            b"unsafe",
        )

    with pytest.raises(QuestionImportParseError) as exc_info:
        parse_question_bank_workbook(
            filename="questions.xlsx",
            content=output.getvalue(),
        )

    assert exc_info.value.code == code


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (
            " VPC-Layout.PNG ",
            "vpc-layout.png",
        ),
        (
            "Résumé.PNG",
            "résumé.png",
        ),
    ],
)
def test_normalizes_image_filenames(
    value,
    expected,
):
    assert normalize_import_image_filename(value) == expected


@pytest.mark.parametrize(
    "value",
    [
        "images/vpc.png",
        r"images\vpc.png",
        "..",
        ".",
    ],
)
def test_rejects_image_paths(
    value,
):
    with pytest.raises(QuestionImportParseError):
        normalize_import_image_filename(value)


def test_asset_lookup_matches_case_insensitively():
    asset = QuestionImportAsset(
        batch_id="11111111-1111-4111-8111-111111111111",
        source_filename="VPC-Layout.PNG",
        normalized_filename="vpc-layout.png",
        byte_size=123,
    )

    lookup = build_import_asset_lookup([asset])

    assert (
        match_import_asset(
            image_filename="vpc-layout.png",
            asset_lookup=lookup,
        )
        is asset
    )

    assert (
        match_import_asset(
            image_filename="VPC-LAYOUT.PNG",
            asset_lookup=lookup,
        )
        is asset
    )


def test_asset_lookup_rejects_ambiguous_normalized_filenames():
    first = QuestionImportAsset(
        batch_id="11111111-1111-4111-8111-111111111111",
        source_filename="VPC.PNG",
        normalized_filename="vpc.png",
        byte_size=123,
    )
    second = QuestionImportAsset(
        batch_id="11111111-1111-4111-8111-111111111111",
        source_filename="vpc.png",
        normalized_filename="vpc.png",
        byte_size=456,
    )

    with pytest.raises(QuestionImportParseError) as exc_info:
        build_import_asset_lookup(
            [
                first,
                second,
            ]
        )

    assert exc_info.value.code == "DUPLICATE_IMAGE_FILENAME"


def test_same_asset_can_match_multiple_rows():
    asset = QuestionImportAsset(
        batch_id="11111111-1111-4111-8111-111111111111",
        source_filename="shared.png",
        normalized_filename="shared.png",
        byte_size=123,
    )

    lookup = build_import_asset_lookup([asset])

    first = match_import_asset(
        image_filename="shared.png",
        asset_lookup=lookup,
    )
    second = match_import_asset(
        image_filename="SHARED.PNG",
        asset_lookup=lookup,
    )

    assert first is asset
    assert second is asset
