from sqlmodel import SQLModel

from app import models  # noqa: F401

EXPECTED_TABLES = {
    "users",
    "certifications",
    "categories",
    "questions",
    "question_versions",
    "answer_options",
    "text_answer_keys",
}


def test_question_bank_tables_registered():
    """All required SQLModel tables are registered."""
    actual_tables = set(SQLModel.metadata.tables)

    assert EXPECTED_TABLES.issubset(actual_tables)


def test_foreign_keys_resolve():
    """Every foreign key resolves to a registered table."""
    for table in SQLModel.metadata.sorted_tables:
        for foreign_key in table.foreign_keys:
            referenced_table = foreign_key.column.table.name

            assert referenced_table in EXPECTED_TABLES


def test_question_version_fields():
    """Question versions support the agreed MVP workflow."""
    table = SQLModel.metadata.tables["question_versions"]

    required_fields = {
        "question_id",
        "version_number",
        "question_text",
        "question_type",
        "allows_multiple_answers",
        "explanation",
        "review_status",
        "publication_status",
        "is_flagged",
    }

    assert required_fields.issubset(table.columns.keys())
    assert "is_published" not in table.columns


def test_publication_constraints():
    """Publication rules are registered in SQLModel."""
    table = SQLModel.metadata.tables["question_versions"]

    constraint_names = {
        constraint.name for constraint in table.constraints if constraint.name
    }

    assert "ck_question_versions_publication" in constraint_names
    assert "ck_question_versions_publication_status" in constraint_names

    indexes = {index.name for index in table.indexes}

    assert "uq_question_versions_active_question" in indexes


def test_answer_options_allow_multiple_correct_answers():
    """No unique index restricts is_correct to one option."""
    table = SQLModel.metadata.tables["answer_options"]

    for index in table.indexes:
        if index.unique:
            indexed_columns = {column.name for column in index.columns}
            assert "is_correct" not in indexed_columns
