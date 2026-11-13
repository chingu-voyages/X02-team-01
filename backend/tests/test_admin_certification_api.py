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


def valid_payload() -> dict[
    str,
    object,
]:
    return {
        "name": ("AWS Cloud Practitioner"),
        "code": "clf-c02",
        "passing_threshold_pct": 70,
        "feedback_mode": "immediate",
    }


def test_administrator_can_create_certification(
    client: TestClient,
    session: Session,
):
    administrator = create_user(
        session,
        UserRole.ADMINISTRATOR,
    )

    response = client.post(
        "/admin/certifications",
        headers=auth_header(administrator),
        json=valid_payload(),
    )

    assert response.status_code == 201

    body = response.json()

    assert body["name"] == "AWS Cloud Practitioner"

    assert body["code"] == "CLF-C02"

    assert body["passing_threshold_pct"] == 70

    assert body["feedback_mode"] == "immediate"

    assert body["is_published"] is False

    records = session.exec(select(Certification)).all()

    assert len(records) == 1

    assert records[0].is_published is False


def test_administrator_can_publish_certification(
    client: TestClient,
    session: Session,
):
    administrator = create_user(
        session,
        UserRole.ADMINISTRATOR,
    )

    create_response = client.post(
        "/admin/certifications",
        headers=auth_header(administrator),
        json=valid_payload(),
    )

    assert create_response.status_code == 201

    certification_id = create_response.json()["id"]

    response = client.patch(
        (f"/admin/certifications/{certification_id}/publication"),
        headers=auth_header(administrator),
        json={
            "is_published": True,
        },
    )

    assert response.status_code == 200

    assert response.json()["is_published"] is True


def test_administrator_can_unpublish_certification(
    client: TestClient,
    session: Session,
):
    administrator = create_user(
        session,
        UserRole.ADMINISTRATOR,
    )

    certification = Certification(
        name="Published Certification",
        code="PUB-1",
        passing_threshold_pct=70,
        feedback_mode="immediate",
        is_published=True,
    )

    session.add(certification)
    session.commit()
    session.refresh(certification)

    response = client.patch(
        (f"/admin/certifications/{certification.id}/publication"),
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
def test_non_administrator_cannot_change_publication(
    client: TestClient,
    session: Session,
    role: UserRole,
):
    actor = create_user(
        session,
        role,
    )

    certification = Certification(
        name="Private Certification",
        code="PRIVATE-1",
        passing_threshold_pct=70,
        feedback_mode="deferred",
        is_published=False,
    )

    session.add(certification)
    session.commit()
    session.refresh(certification)

    response = client.patch(
        (f"/admin/certifications/{certification.id}/publication"),
        headers=auth_header(actor),
        json={
            "is_published": True,
        },
    )

    assert response.status_code == 403

    session.refresh(certification)

    assert certification.is_published is False


def test_missing_certification_publication_returns_404(
    client: TestClient,
    session: Session,
):
    administrator = create_user(
        session,
        UserRole.ADMINISTRATOR,
    )

    response = client.patch(
        (f"/admin/certifications/{uuid4()}/publication"),
        headers=auth_header(administrator),
        json={
            "is_published": True,
        },
    )

    assert response.status_code == 404

    assert response.json() == {"detail": ("Certification not found")}


def test_contributor_cannot_create_certification(
    client: TestClient,
    session: Session,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )

    response = client.post(
        "/admin/certifications",
        headers=auth_header(contributor),
        json=valid_payload(),
    )

    assert response.status_code == 403


def test_learner_cannot_create_certification(
    client: TestClient,
    session: Session,
):
    learner = create_user(
        session,
        UserRole.LEARNER,
    )

    response = client.post(
        "/admin/certifications",
        headers=auth_header(learner),
        json=valid_payload(),
    )

    assert response.status_code == 403


def test_unauthenticated_create_is_rejected(
    client: TestClient,
):
    response = client.post(
        "/admin/certifications",
        json=valid_payload(),
    )

    assert response.status_code == 401


def test_duplicate_code_returns_conflict(
    client: TestClient,
    session: Session,
):
    administrator = create_user(
        session,
        UserRole.ADMINISTRATOR,
    )

    headers = auth_header(administrator)

    first = client.post(
        "/admin/certifications",
        headers=headers,
        json=valid_payload(),
    )

    second = client.post(
        "/admin/certifications",
        headers=headers,
        json=valid_payload(),
    )

    assert first.status_code == 201

    assert second.status_code == 409


def test_invalid_threshold_is_rejected(
    client: TestClient,
    session: Session,
):
    administrator = create_user(
        session,
        UserRole.ADMINISTRATOR,
    )

    payload = valid_payload()

    payload["passing_threshold_pct"] = 101

    response = client.post(
        "/admin/certifications",
        headers=auth_header(administrator),
        json=payload,
    )

    assert response.status_code == 422


def test_authorized_manager_can_list_certifications(
    client: TestClient,
    session: Session,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )

    session.add_all(
        [
            Certification(
                name=("Professional Scrum Master"),
                code="PSM-I",
                passing_threshold_pct=65,
                feedback_mode="immediate",
                is_published=True,
            ),
            Certification(
                name="Security Plus",
                code="SEC+",
                passing_threshold_pct=75,
                feedback_mode="deferred",
                is_published=False,
            ),
        ]
    )

    session.commit()

    response = client.get(
        "/admin/certifications",
        headers=auth_header(contributor),
    )

    assert response.status_code == 200

    body = response.json()

    assert body["count"] == 2

    states = {item["code"]: (item["is_published"]) for item in body["items"]}

    assert states == {
        "PSM-I": True,
        "SEC+": False,
    }


def test_learner_cannot_list_admin_certifications(
    client: TestClient,
    session: Session,
):
    learner = create_user(
        session,
        UserRole.LEARNER,
    )

    response = client.get(
        "/admin/certifications",
        headers=auth_header(learner),
    )

    assert response.status_code == 403
