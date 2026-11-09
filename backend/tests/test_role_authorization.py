from collections.abc import Iterator
from typing import Annotated
from uuid import uuid4

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, create_engine

from app.api.deps import (
    get_current_user,
    require_administrator,
    require_contributor_or_administrator,
    require_roles,
)
from app.core.roles import UserRole
from app.core.security import create_access_token
from app.db.session import get_session
from app.models.user import User

app = FastAPI()


@app.get("/me")
def me(
    user: Annotated[User, Depends(get_current_user)],
) -> dict[str, str]:
    return {"id": str(user.id), "role": user.role.value}


@app.get("/contributor")
def contributor(
    user: Annotated[
        User,
        Depends(require_contributor_or_administrator),
    ],
) -> dict[str, str]:
    return {"role": user.role.value}


@app.get("/administrator")
def administrator(
    user: Annotated[User, Depends(require_administrator)],
) -> dict[str, str]:
    return {"role": user.role.value}


@pytest.fixture
def session() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    User.__table__.create(engine)

    with Session(engine) as database_session:
        yield database_session

    engine.dispose()


@pytest.fixture
def client(session: Session) -> Iterator[TestClient]:
    def override_session() -> Iterator[Session]:
        yield session

    app.dependency_overrides[get_session] = override_session

    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


def create_user(session: Session, role: UserRole) -> User:
    user = User(
        email=f"{uuid4()}@example.com",
        role=role,
    )

    session.add(user)
    session.commit()
    session.refresh(user)

    return user


def auth_header(user: User) -> dict[str, str]:
    token = create_access_token(str(user.id))

    return {
        "Authorization": f"Bearer {token}",
    }


@pytest.mark.parametrize("role", list(UserRole))
def test_current_user_is_loaded_from_database(
    client: TestClient,
    session: Session,
    role: UserRole,
):
    user = create_user(session, role)

    response = client.get(
        "/me",
        headers=auth_header(user),
    )

    assert response.status_code == 200
    assert response.json() == {
        "id": str(user.id),
        "role": role.value,
    }


def test_current_user_rejects_non_uuid_subject(
    client: TestClient,
):
    token = create_access_token("not-a-user-id")

    response = client.get(
        "/me",
        headers={
            "Authorization": f"Bearer {token}",
        },
    )

    assert response.status_code == 401
    assert response.json() == {
        "detail": "Invalid authentication subject",
    }


def test_current_user_rejects_missing_account(
    client: TestClient,
):
    token = create_access_token(str(uuid4()))

    response = client.get(
        "/me",
        headers={
            "Authorization": f"Bearer {token}",
        },
    )

    assert response.status_code == 401
    assert response.json() == {
        "detail": "Authenticated account not found",
    }


@pytest.mark.parametrize(
    ("role", "expected_status"),
    [
        (UserRole.LEARNER, 403),
        (UserRole.CONTRIBUTOR, 200),
        (UserRole.ADMINISTRATOR, 200),
    ],
)
def test_contributor_guard_permission_matrix(
    client: TestClient,
    session: Session,
    role: UserRole,
    expected_status: int,
):
    user = create_user(session, role)

    response = client.get(
        "/contributor",
        headers=auth_header(user),
    )

    assert response.status_code == expected_status


@pytest.mark.parametrize(
    ("role", "expected_status"),
    [
        (UserRole.LEARNER, 403),
        (UserRole.CONTRIBUTOR, 403),
        (UserRole.ADMINISTRATOR, 200),
    ],
)
def test_administrator_guard_permission_matrix(
    client: TestClient,
    session: Session,
    role: UserRole,
    expected_status: int,
):
    user = create_user(session, role)

    response = client.get(
        "/administrator",
        headers=auth_header(user),
    )

    assert response.status_code == expected_status


def test_forbidden_response_is_safe(
    client: TestClient,
    session: Session,
):
    user = create_user(
        session,
        UserRole.LEARNER,
    )

    response = client.get(
        "/administrator",
        headers=auth_header(user),
    )

    assert response.status_code == 403
    assert response.json() == {
        "detail": "Insufficient permissions",
    }


def test_role_change_takes_effect_without_new_token(
    client: TestClient,
    session: Session,
):
    user = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )

    headers = auth_header(user)

    before = client.get(
        "/administrator",
        headers=headers,
    )

    assert before.status_code == 403

    user.role = UserRole.ADMINISTRATOR
    session.add(user)
    session.commit()

    after = client.get(
        "/administrator",
        headers=headers,
    )

    assert after.status_code == 200


def test_role_guard_requires_at_least_one_role():
    with pytest.raises(
        ValueError,
        match="At least one allowed role",
    ):
        require_roles()
