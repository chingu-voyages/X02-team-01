"""Role contract and database compatibility tests."""

from collections.abc import Iterator

import pytest
import sqlalchemy as sa
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.core.roles import UserRole
from app.models.user import User


@pytest.fixture
def role_engine() -> Iterator[Engine]:
    engine = sa.create_engine("sqlite://")

    try:
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
    user = User(
        email="learner@example.test",
        full_name="Learner",
    )

    assert user.role == UserRole.LEARNER.value


@pytest.mark.parametrize(
    "role",
    list(UserRole),
)
def test_valid_roles_serialize_to_lowercase_values(
    role: UserRole,
) -> None:
    user = User.model_validate(
        {
            "email": "user@example.test",
            "full_name": "User",
            "role": role.value,
        }
    )

    assert user.role == role.value
    assert user.model_dump(mode="json")["role"] == role.value


@pytest.mark.parametrize(
    "role",
    list(UserRole),
)
def test_all_roles_round_trip_through_database(
    role_engine: Engine,
    role: UserRole,
) -> None:
    with Session(role_engine) as session:
        user = User(
            email=f"{role.value}@example.test",
            full_name="Role User",
            role=role.value,
        )

        user_id = user.id

        session.add(user)
        session.commit()

    with Session(role_engine) as session:
        stored = session.get(User, user_id)

        assert stored is not None
        assert stored.role == role.value

    with role_engine.connect() as connection:
        stored_role = connection.scalar(
            sa.text("SELECT role FROM users WHERE email = :email"),
            {
                "email": f"{role.value}@example.test",
            },
        )

        assert stored_role == role.value


def test_omitted_role_persists_as_learner(
    role_engine: Engine,
) -> None:
    with Session(role_engine) as session:
        user = User(
            email="default@example.test",
            full_name="Default Learner",
        )

        session.add(user)
        session.commit()
        session.refresh(user)

        assert user.role == UserRole.LEARNER.value


@pytest.mark.parametrize(
    "role",
    [
        "admin",
        "super_admin",
        "reviewer",
        "LEARNER",
        "Administrator",
        "",
        None,
    ],
)
def test_database_rejects_invalid_roles_without_changing_user(
    role_engine: Engine,
    role: str | None,
) -> None:
    with Session(role_engine) as session:
        user = User(
            email="unchanged@example.test",
            full_name="Unchanged User",
            role=UserRole.LEARNER.value,
        )

        session.add(user)
        session.commit()

        user_id = user.id

    with role_engine.begin() as connection:
        with pytest.raises(IntegrityError), connection.begin_nested():
            connection.execute(
                sa.text("UPDATE users SET role = :role WHERE id = :user_id"),
                {
                    "role": role,
                    "user_id": user_id.hex,
                },
            )

        stored_role = connection.scalar(
            sa.text("SELECT role FROM users WHERE id = :user_id"),
            {
                "user_id": user_id.hex,
            },
        )

        assert stored_role == UserRole.LEARNER.value


def test_model_creates_named_role_constraint(
    role_engine: Engine,
) -> None:
    checks = sa.inspect(role_engine).get_check_constraints("users")

    assert "ck_users_role" in {constraint["name"] for constraint in checks}


def test_role_schema_coexists_with_registration_fields(
    role_engine: Engine,
) -> None:
    columns = {
        column["name"] for column in sa.inspect(role_engine).get_columns("users")
    }

    assert {
        "id",
        "email",
        "full_name",
        "hashed_password",
        "role",
        "is_verified",
        "last_verification_sent_at",
        "created_at",
    }.issubset(columns)
