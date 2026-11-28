"""Check the essay migration's PostgreSQL DDL and real constraint behavior."""

import os
from importlib.util import module_from_spec, spec_from_file_location
from io import StringIO
from pathlib import Path
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.exc import IntegrityError

from app.db.session import engine

MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "e120a6b4c9d2_add_essay_question_type.py"
)


@pytest.fixture
def migration():
    spec = spec_from_file_location("essay_type_migration", MIGRATION)
    assert spec is not None and spec.loader is not None
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_postgresql_migration_sql(migration):
    assert migration.down_revision == "d122203a4b5c"
    output = StringIO()
    context = MigrationContext.configure(
        dialect_name="postgresql",
        opts={"as_sql": True, "output_buffer": output},
    )
    with Operations.context(context):
        migration.upgrade()
        migration.downgrade()
    ddl = output.getvalue()
    assert ddl.count("DROP CONSTRAINT ck_question_versions_type") == 2
    assert "IN ('multiple_choice', 'short_answer', 'essay')" in ddl
    assert "IN ('multiple_choice', 'short_answer')" in ddl
    assert "DELETE" not in ddl.upper()


def test_real_postgres_upgrade_and_safe_downgrade(migration):
    if os.getenv("RUN_DB_INTEGRATION") != "1":
        pytest.skip("PostgreSQL integration tests are opt-in")
    if engine.url.get_backend_name() != "postgresql" or engine.url.host not in (
        "localhost",
        "127.0.0.1",
        None,
    ):
        pytest.fail("Use disposable local PostgreSQL only")
    schema = f"jhep120_migration_{uuid4().hex[:12]}"
    with engine.connect() as connection:
        outer = connection.begin()
        try:
            connection.execute(sa.text(f'CREATE SCHEMA "{schema}"'))
            connection.execute(sa.text(f'SET LOCAL search_path TO "{schema}"'))
            connection.execute(
                sa.text(
                    "CREATE TABLE question_versions ("
                    "id integer primary key, question_type varchar(32) not null, "
                    "CONSTRAINT ck_question_versions_type CHECK "
                    "(question_type IN ('multiple_choice', 'short_answer')))"
                )
            )
            connection.execute(
                sa.text(
                    "INSERT INTO question_versions VALUES "
                    "(1, 'multiple_choice'), (2, 'short_answer')"
                )
            )
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
                connection.execute(
                    sa.text("INSERT INTO question_versions VALUES (3, 'essay')")
                )
                with pytest.raises(IntegrityError), connection.begin_nested():
                    connection.execute(
                        sa.text("INSERT INTO question_versions VALUES (4, 'unknown')")
                    )
                with pytest.raises(IntegrityError), connection.begin_nested():
                    migration.downgrade()
                assert connection.execute(
                    sa.text("SELECT question_type FROM question_versions ORDER BY id")
                ).scalars().all() == ["multiple_choice", "short_answer", "essay"]
                connection.execute(sa.text("DELETE FROM question_versions WHERE id=3"))
                migration.downgrade()
                with pytest.raises(IntegrityError), connection.begin_nested():
                    connection.execute(
                        sa.text("INSERT INTO question_versions VALUES (3, 'essay')")
                    )
                assert (
                    connection.scalar(sa.text("SELECT count(*) FROM question_versions"))
                    == 2
                )
        finally:
            outer.rollback()
