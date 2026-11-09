"""Role contract and ORM tests using an isolated in-memory database."""

from collections.abc import Iterator
from uuid import uuid4

import pytest
import sqlalchemy as sa
from pydantic import ValidationError
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.core.roles import UserRole
from app.models.user import User


@pytest.fixture
def role_engine() -> Iterator[Engine]:
    engine = sa.create_engine("sqlite://")
    try:
        # Only this table is needed; do not create the entire application schema.
        User.__table__.create(engine)
        yield engine
    finally:
        engine.dispose()


def test_exactly_three_mvp_roles() -> None:
    assert {role.value for role in UserRole} == {
        "learner",
        "contributor",
        "administrator",
    }
    assert len(UserRole.__members__) == 3


def test_new_user_defaults_to_learner() -> None:
    user = User(email="learner@example.test")
    assert user.role is UserRole.LEARNER


@pytest.mark.parametrize("role", list(UserRole))
def test_valid_roles_serialize_to_lowercase_values(role: UserRole) -> None:
    user = User.model_validate({"email": "user@example.test", "role": role.value})
    assert user.role is role
    assert user.model_dump(mode="json")["role"] == role.value


@pytest.mark.parametrize(
    "role",
    ["admin", "super_admin", "reviewer", "LEARNER", "Administrator", "", None],
)
def test_explicit_model_validation_rejects_invalid_roles(role: str | None) -> None:
    # SQLModel table constructors are not public request validation schemas.
    # Exercise model_validate explicitly rather than relying on User(...).
    with pytest.raises(ValidationError):
        User.model_validate({"email": "user@example.test", "role": role})


@pytest.mark.parametrize("role", list(UserRole))
def test_all_roles_round_trip_through_database(
    role_engine: Engine, role: UserRole
) -> None:
    with Session(role_engine) as session:
        user = User(email="user@example.test", role=role)
        user_id = user.id
        session.add(user)
        session.commit()

    # A different session proves this is a database read, not cached state.
    with Session(role_engine) as session:
        stored = session.get(User, user_id)
        assert stored is not None
        assert stored.role is role

    with role_engine.connect() as connection:
        assert connection.scalar(sa.text("SELECT role FROM users")) == role.value


def test_omitted_role_persists_as_learner(role_engine: Engine) -> None:
    with Session(role_engine) as session:
        user = User(email="default@example.test")
        session.add(user)
        session.commit()
        session.refresh(user)
        assert user.role is UserRole.LEARNER


def test_raw_insert_gets_database_learner_default(role_engine: Engine) -> None:
    with role_engine.begin() as connection:
        connection.execute(
            sa.text("INSERT INTO users (id, email) VALUES (:id, :email)"),
            {"id": uuid4().hex, "email": "raw@example.test"},
        )
        assert connection.scalar(sa.text("SELECT role FROM users")) == "learner"


@pytest.mark.parametrize(
    "role",
    ["admin", "super_admin", "reviewer", "LEARNER", "Administrator", "", None],
)
def test_database_rejects_invalid_roles_without_changing_user(
    role_engine: Engine, role: str | None
) -> None:
    with role_engine.begin() as connection:
        connection.execute(
            sa.text("INSERT INTO users (id, email) VALUES (:id, :email)"),
            {"id": uuid4().hex, "email": "unchanged@example.test"},
        )
        with pytest.raises(IntegrityError), connection.begin_nested():
            # Raw SQL bypasses Pydantic and the SQLAlchemy enum validator.
            connection.execute(sa.text("UPDATE users SET role = :role"), {"role": role})
        assert connection.scalar(sa.text("SELECT role FROM users")) == "learner"


def test_model_creates_named_role_constraint(role_engine: Engine) -> None:
    checks = sa.inspect(role_engine).get_check_constraints("users")
    assert "ck_users_role" in {constraint["name"] for constraint in checks}
