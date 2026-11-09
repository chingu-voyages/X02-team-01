"""Exercise the real role migration without touching the app database.

SQLite tests verify data preservation and constraints. PostgreSQL DDL rendering
is also checked; rendering is not a live PostgreSQL integration test.
"""

from collections.abc import Iterator
from datetime import UTC, datetime
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
    / "f2a1c7d9e430_add_user_roles.py"
)


@pytest.fixture
def role_migration() -> ModuleType:
    spec = spec_from_file_location("user_roles_migration", MIGRATION_PATH)
    assert spec is not None and spec.loader is not None
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def legacy_users_connection() -> Iterator[Connection]:
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    users = sa.Table(
        "users",
        metadata,
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("email", sa.String(255), unique=True, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    try:
        with engine.begin() as connection:
            metadata.create_all(connection)
            connection.execute(
                users.insert(),
                [
                    {
                        "id": uuid4(),
                        "email": "first@example.test",
                        "created_at": datetime(2026, 11, 1, tzinfo=UTC),
                    },
                    {
                        "id": uuid4(),
                        "email": "second@example.test",
                        "created_at": datetime(2026, 11, 2, tzinfo=UTC),
                    },
                ],
            )
            yield connection
    finally:
        engine.dispose()


def apply_role_migration(
    connection: Connection, migration: ModuleType, *, downgrade: bool = False
) -> None:
    context = MigrationContext.configure(connection)
    with Operations.context(context):
        if downgrade:
            migration.downgrade()
        else:
            migration.upgrade()


def test_role_migration_extends_expected_parent(role_migration: ModuleType) -> None:
    assert role_migration.revision == "f2a1c7d9e430"
    assert role_migration.down_revision == "d7f3a91c2e60"


def test_upgrade_preserves_accounts_and_defaults_existing_roles_to_learner(
    legacy_users_connection: Connection, role_migration: ModuleType
) -> None:
    connection = legacy_users_connection
    before = connection.execute(
        sa.text("SELECT id, email, created_at FROM users ORDER BY email")
    ).all()

    apply_role_migration(connection, role_migration)

    after = connection.execute(
        sa.text("SELECT id, email, created_at FROM users ORDER BY email")
    ).all()
    assert after == before
    assert connection.scalars(sa.text("SELECT role FROM users")).all() == [
        "learner",
        "learner",
    ]
    columns = {
        column["name"]: column for column in sa.inspect(connection).get_columns("users")
    }
    assert set(columns) == {"id", "email", "created_at", "role"}
    assert columns["role"]["nullable"] is False
    assert columns["role"]["default"] is not None
    checks = sa.inspect(connection).get_check_constraints("users")
    assert "ck_users_role" in {constraint["name"] for constraint in checks}


def test_migrated_table_defaults_new_raw_insert_to_learner(
    legacy_users_connection: Connection, role_migration: ModuleType
) -> None:
    connection = legacy_users_connection
    apply_role_migration(connection, role_migration)
    connection.execute(
        sa.text("INSERT INTO users (id, email) VALUES (:id, :email)"),
        {"id": uuid4().hex, "email": "new@example.test"},
    )
    assert (
        connection.scalar(
            sa.text("SELECT role FROM users WHERE email = 'new@example.test'")
        )
        == "learner"
    )


@pytest.mark.parametrize("role", ["learner", "contributor", "administrator"])
def test_migrated_table_accepts_supported_roles(
    legacy_users_connection: Connection, role_migration: ModuleType, role: str
) -> None:
    connection = legacy_users_connection
    apply_role_migration(connection, role_migration)
    connection.execute(sa.text("UPDATE users SET role = :role"), {"role": role})
    assert connection.scalars(sa.text("SELECT role FROM users")).all() == [role, role]


@pytest.mark.parametrize(
    "role",
    ["admin", "super_admin", "reviewer", "LEARNER", "Administrator", "", None],
)
def test_migrated_table_rejects_invalid_roles_without_changing_accounts(
    legacy_users_connection: Connection,
    role_migration: ModuleType,
    role: str | None,
) -> None:
    connection = legacy_users_connection
    apply_role_migration(connection, role_migration)
    before = connection.execute(sa.text("SELECT * FROM users ORDER BY email")).all()

    with pytest.raises(IntegrityError), connection.begin_nested():
        connection.execute(sa.text("UPDATE users SET role = :role"), {"role": role})

    after = connection.execute(sa.text("SELECT * FROM users ORDER BY email")).all()
    assert after == before


def test_migration_preserves_unique_email_constraint(
    legacy_users_connection: Connection, role_migration: ModuleType
) -> None:
    connection = legacy_users_connection
    apply_role_migration(connection, role_migration)
    with pytest.raises(IntegrityError), connection.begin_nested():
        connection.execute(
            sa.text("INSERT INTO users (id, email) VALUES (:id, :email)"),
            {"id": uuid4().hex, "email": "first@example.test"},
        )
    assert connection.scalar(sa.text("SELECT COUNT(*) FROM users")) == 2


def test_downgrade_preserves_original_fields_and_rows(
    legacy_users_connection: Connection, role_migration: ModuleType
) -> None:
    connection = legacy_users_connection
    before = connection.execute(
        sa.text("SELECT id, email, created_at FROM users ORDER BY email")
    ).all()
    apply_role_migration(connection, role_migration)
    connection.execute(sa.text("UPDATE users SET role = 'administrator'"))

    apply_role_migration(connection, role_migration, downgrade=True)

    assert {
        column["name"] for column in sa.inspect(connection).get_columns("users")
    } == {"id", "email", "created_at"}
    assert (
        connection.execute(
            sa.text("SELECT id, email, created_at FROM users ORDER BY email")
        ).all()
        == before
    )


def test_role_migration_renders_postgresql_ddl(role_migration: ModuleType) -> None:
    output = StringIO()
    context = MigrationContext.configure(
        dialect_name="postgresql",
        opts={"as_sql": True, "output_buffer": output},
    )
    with Operations.context(context):
        role_migration.upgrade()
        role_migration.downgrade()

    sql = " ".join(output.getvalue().split())
    assert "ALTER TABLE users ADD COLUMN role VARCHAR(32)" in sql
    assert "DEFAULT 'learner' NOT NULL" in sql
    assert (
        "CONSTRAINT ck_users_role CHECK "
        "(role IN ('learner', 'contributor', 'administrator'))" in sql
    )
    assert "ALTER TABLE users DROP COLUMN role;" in sql
