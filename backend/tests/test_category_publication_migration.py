"""Exercise the actual migration without touching the application's database.

SQLite verifies this additive migration and its data effects. PostgreSQL SQL
rendering is checked separately; that is not a live PostgreSQL migration test.
"""

from collections.abc import Iterator
from importlib.util import module_from_spec, spec_from_file_location
from io import StringIO
from pathlib import Path
from types import ModuleType
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "d7f3a91c2e60_add_category_publication.py"
)


@pytest.fixture
def migration() -> ModuleType:
    spec = spec_from_file_location("category_publication_migration", MIGRATION_PATH)
    assert spec is not None and spec.loader is not None
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def legacy_connection() -> Iterator[Connection]:
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    categories = sa.Table(
        "categories",
        metadata,
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("certification_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.UniqueConstraint("certification_id", "name"),
        sa.UniqueConstraint("certification_id", "id"),
    )
    try:
        with engine.begin() as connection:
            metadata.create_all(connection)
            connection.execute(
                categories.insert(),
                {
                    "id": uuid4(),
                    "certification_id": uuid4(),
                    "name": "Existing category",
                },
            )
            yield connection
    finally:
        engine.dispose()


def apply_migration(connection, migration, *, downgrade=False):
    context = MigrationContext.configure(connection)
    with Operations.context(context):
        if downgrade:
            migration.downgrade()
        else:
            migration.upgrade()


def test_migration_extends_expected_parent(migration):
    assert migration.revision == "d7f3a91c2e60"
    assert migration.down_revision == "cb8e51f7a6d2"


def test_upgrade_preserves_rows_and_defaults_existing_category_to_false(
    legacy_connection, migration
):
    before = legacy_connection.execute(
        sa.text("SELECT id, certification_id, name FROM categories")
    ).all()

    apply_migration(legacy_connection, migration)

    after = legacy_connection.execute(
        sa.text("SELECT id, certification_id, name FROM categories")
    ).all()
    assert after == before
    assert legacy_connection.scalar(sa.text("SELECT is_published FROM categories")) == 0
    columns = {
        column["name"]: column
        for column in sa.inspect(legacy_connection).get_columns("categories")
    }
    assert set(columns) == {"id", "certification_id", "name", "is_published"}
    assert columns["is_published"]["nullable"] is False
    assert columns["is_published"]["default"] is not None


def test_migrated_table_defaults_new_raw_insert_to_false(legacy_connection, migration):
    apply_migration(legacy_connection, migration)
    category_id = uuid4().hex
    legacy_connection.execute(
        sa.text(
            "INSERT INTO categories (id, certification_id, name) "
            "VALUES (:id, :certification_id, :name)"
        ),
        {
            "id": category_id,
            "certification_id": uuid4().hex,
            "name": "New category",
        },
    )

    assert (
        legacy_connection.scalar(
            sa.text("SELECT is_published FROM categories WHERE id = :id"),
            {"id": category_id},
        )
        == 0
    )


@pytest.mark.parametrize("published", [False, True])
def test_migrated_table_accepts_explicit_publication(
    legacy_connection, migration, published
):
    apply_migration(legacy_connection, migration)
    legacy_connection.execute(
        sa.text("UPDATE categories SET is_published = :published"),
        {"published": published},
    )

    assert legacy_connection.scalar(
        sa.text("SELECT is_published FROM categories")
    ) == int(published)


def test_migrated_table_rejects_explicit_null(legacy_connection, migration):
    apply_migration(legacy_connection, migration)

    with pytest.raises(IntegrityError), legacy_connection.begin_nested():
        legacy_connection.execute(sa.text("UPDATE categories SET is_published = NULL"))


def test_downgrade_preserves_original_fields_and_rows(legacy_connection, migration):
    before = legacy_connection.execute(
        sa.text("SELECT id, certification_id, name FROM categories")
    ).all()
    apply_migration(legacy_connection, migration)
    legacy_connection.execute(sa.text("UPDATE categories SET is_published = true"))

    apply_migration(legacy_connection, migration, downgrade=True)

    assert {
        column["name"]
        for column in sa.inspect(legacy_connection).get_columns("categories")
    } == {"id", "certification_id", "name"}
    assert (
        legacy_connection.execute(
            sa.text("SELECT id, certification_id, name FROM categories")
        ).all()
        == before
    )


def test_migration_renders_postgresql_ddl(migration):
    output = StringIO()
    context = MigrationContext.configure(
        dialect_name="postgresql",
        opts={"as_sql": True, "output_buffer": output},
    )
    with Operations.context(context):
        migration.upgrade()
        migration.downgrade()

    sql = " ".join(output.getvalue().split())
    assert (
        "ALTER TABLE categories ADD COLUMN is_published BOOLEAN DEFAULT false NOT NULL;"
        in sql
    )
    assert "ALTER TABLE categories DROP COLUMN is_published;" in sql
