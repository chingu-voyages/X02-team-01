from collections.abc import Iterator
from uuid import uuid4

import pytest
import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import (
    Session,
    SQLModel,
    create_engine,
    select,
)

from app.api.v1.endpoints import admin
from app.core.roles import UserRole
from app.core.security import (
    create_access_token,
)
from app.db.session import get_session
from app.models.category import Category
from app.models.certification import (
    Certification,
)
from app.models.user import User

app = FastAPI()

app.include_router(
    admin.router,
    prefix="/admin",
)


@pytest.fixture
def engine():
    engine = create_engine(
        "sqlite://",
        connect_args={
            "check_same_thread": False,
        },
        poolclass=StaticPool,
    )

    @sa.event.listens_for(
        engine,
        "connect",
    )
    def enable_foreign_keys(
        dbapi_connection,
        _connection_record,
    ):
        cursor = dbapi_connection.cursor()

        cursor.execute("PRAGMA foreign_keys=ON")

        cursor.close()

    SQLModel.metadata.create_all(
        engine,
        tables=[
            User.__table__,
            Certification.__table__,
            Category.__table__,
        ],
    )

    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture
def session(
    engine,
) -> Iterator[Session]:
    with Session(engine) as database_session:
        yield database_session


@pytest.fixture
def client(
    session: Session,
) -> Iterator[TestClient]:
    def override_session() -> Iterator[Session]:
        yield session

    app.dependency_overrides[get_session] = override_session

    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


def create_user(
    session: Session,
    role: UserRole,
) -> User:
    user = User(
        email=(f"{uuid4()}@example.test"),
        role=role,
    )

    session.add(user)
    session.commit()
    session.refresh(user)

    return user


def auth_header(
    user: User,
) -> dict[str, str]:
    return {"Authorization": (f"Bearer {create_access_token(str(user.id))}")}


def create_certification(
    session: Session,
    *,
    name: str = "Example Certification",
) -> Certification:
    certification = Certification(
        name=name,
        code=(f"CERT-{uuid4().hex[:8]}"),
        passing_threshold_pct=70,
        feedback_mode="immediate",
        is_published=False,
    )

    session.add(certification)
    session.commit()
    session.refresh(certification)

    return certification


def test_administrator_can_create_category(
    client: TestClient,
    session: Session,
):
    administrator = create_user(
        session,
        UserRole.ADMINISTRATOR,
    )

    certification = create_certification(session)

    response = client.post(
        "/admin/categories",
        headers=auth_header(administrator),
        json={
            "certification_id": (str(certification.id)),
            "name": ("  Scrum Fundamentals  "),
        },
    )

    assert response.status_code == 201

    body = response.json()

    assert body["certification_id"] == str(certification.id)

    assert body["certification_name"] == certification.name

    assert body["name"] == "Scrum Fundamentals"

    assert body["is_published"] is False


def test_category_requires_existing_certification(
    client: TestClient,
    session: Session,
):
    administrator = create_user(
        session,
        UserRole.ADMINISTRATOR,
    )

    response = client.post(
        "/admin/categories",
        headers=auth_header(administrator),
        json={
            "certification_id": (str(uuid4())),
            "name": "Missing parent",
        },
    )

    assert response.status_code == 404

    assert response.json() == {"detail": ("Certification not found")}


def test_duplicate_category_name_returns_conflict(
    client: TestClient,
    session: Session,
):
    administrator = create_user(
        session,
        UserRole.ADMINISTRATOR,
    )

    certification = create_certification(session)

    headers = auth_header(administrator)

    first = client.post(
        "/admin/categories",
        headers=headers,
        json={
            "certification_id": (str(certification.id)),
            "name": "Fundamentals",
        },
    )

    second = client.post(
        "/admin/categories",
        headers=headers,
        json={
            "certification_id": (str(certification.id)),
            "name": "fundamentals",
        },
    )

    assert first.status_code == 201

    assert second.status_code == 409


@pytest.mark.parametrize(
    "role",
    [
        UserRole.CONTRIBUTOR,
        UserRole.LEARNER,
    ],
)
def test_non_administrator_cannot_create_category(
    client: TestClient,
    session: Session,
    role: UserRole,
):
    actor = create_user(
        session,
        role,
    )

    certification = create_certification(session)

    response = client.post(
        "/admin/categories",
        headers=auth_header(actor),
        json={
            "certification_id": (str(certification.id)),
            "name": "Restricted",
        },
    )

    assert response.status_code == 403


def test_administrator_can_publish_category(
    client: TestClient,
    session: Session,
):
    administrator = create_user(
        session,
        UserRole.ADMINISTRATOR,
    )

    certification = create_certification(session)

    category = Category(
        certification_id=(certification.id),
        name="Fundamentals",
        is_published=False,
    )

    session.add(category)
    session.commit()
    session.refresh(category)

    response = client.patch(
        (f"/admin/categories/{category.id}/publication"),
        headers=auth_header(administrator),
        json={
            "is_published": True,
        },
    )

    assert response.status_code == 200

    assert response.json()["is_published"] is True

    session.refresh(category)

    assert category.is_published is True


def test_administrator_can_unpublish_category(
    client: TestClient,
    session: Session,
):
    administrator = create_user(
        session,
        UserRole.ADMINISTRATOR,
    )

    certification = create_certification(session)

    category = Category(
        certification_id=(certification.id),
        name="Fundamentals",
        is_published=True,
    )

    session.add(category)
    session.commit()
    session.refresh(category)

    response = client.patch(
        (f"/admin/categories/{category.id}/publication"),
        headers=auth_header(administrator),
        json={
            "is_published": False,
        },
    )

    assert response.status_code == 200

    assert response.json()["is_published"] is False


@pytest.mark.parametrize(
    "role",
    [
        UserRole.CONTRIBUTOR,
        UserRole.LEARNER,
    ],
)
def test_non_administrator_cannot_change_category_publication(
    client: TestClient,
    session: Session,
    role: UserRole,
):
    actor = create_user(
        session,
        role,
    )

    certification = create_certification(session)

    category = Category(
        certification_id=(certification.id),
        name="Restricted Category",
        is_published=False,
    )

    session.add(category)
    session.commit()
    session.refresh(category)

    response = client.patch(
        (f"/admin/categories/{category.id}/publication"),
        headers=auth_header(actor),
        json={
            "is_published": True,
        },
    )

    assert response.status_code == 403


def test_missing_category_publication_returns_404(
    client: TestClient,
    session: Session,
):
    administrator = create_user(
        session,
        UserRole.ADMINISTRATOR,
    )

    response = client.patch(
        (f"/admin/categories/{uuid4()}/publication"),
        headers=auth_header(administrator),
        json={
            "is_published": True,
        },
    )

    assert response.status_code == 404

    assert response.json() == {"detail": "Category not found"}


def test_manager_can_list_all_categories(
    client: TestClient,
    session: Session,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )

    certification = create_certification(session)

    session.add_all(
        [
            Category(
                certification_id=(certification.id),
                name="Published",
                is_published=True,
            ),
            Category(
                certification_id=(certification.id),
                name="Draft",
                is_published=False,
            ),
        ]
    )

    session.commit()

    response = client.get(
        "/admin/categories",
        headers=auth_header(contributor),
    )

    assert response.status_code == 200

    body = response.json()

    assert body["count"] == 2

    states = {item["name"]: (item["is_published"]) for item in body["items"]}

    assert states == {
        "Draft": False,
        "Published": True,
    }


def test_category_list_can_filter_by_certification(
    client: TestClient,
    session: Session,
):
    administrator = create_user(
        session,
        UserRole.ADMINISTRATOR,
    )

    first_certification = create_certification(
        session,
        name="First",
    )

    second_certification = create_certification(
        session,
        name="Second",
    )

    session.add_all(
        [
            Category(
                certification_id=(first_certification.id),
                name="First Category",
                is_published=False,
            ),
            Category(
                certification_id=(second_certification.id),
                name="Second Category",
                is_published=False,
            ),
        ]
    )

    session.commit()

    response = client.get(
        "/admin/categories",
        params={"certification_id": (str(first_certification.id))},
        headers=auth_header(administrator),
    )

    assert response.status_code == 200

    body = response.json()

    assert body["count"] == 1

    assert body["items"][0]["name"] == "First Category"


def test_learner_cannot_list_admin_categories(
    client: TestClient,
    session: Session,
):
    learner = create_user(
        session,
        UserRole.LEARNER,
    )

    response = client.get(
        "/admin/categories",
        headers=auth_header(learner),
    )

    assert response.status_code == 403


def test_created_category_is_persisted(
    client: TestClient,
    session: Session,
):
    administrator = create_user(
        session,
        UserRole.ADMINISTRATOR,
    )

    certification = create_certification(session)

    response = client.post(
        "/admin/categories",
        headers=auth_header(administrator),
        json={
            "certification_id": (str(certification.id)),
            "name": "Persistence Test",
        },
    )

    assert response.status_code == 201

    categories = session.exec(select(Category)).all()

    assert len(categories) == 1

    assert categories[0].name == "Persistence Test"

    assert categories[0].is_published is False
