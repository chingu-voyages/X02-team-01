from collections.abc import Iterator
from datetime import UTC, datetime
from uuid import uuid4

import pytest
import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.api.v1.endpoints import admin
from app.core.roles import UserRole
from app.core.security import create_access_token
from app.db.session import get_session
from app.models.answer_option import AnswerOption
from app.models.category import Category
from app.models.certification import Certification
from app.models.question import Question
from app.models.question_version import QuestionVersion
from app.models.text_answer_key import TextAnswerKey
from app.models.user import User
from app.schemas.admin_question import QuestionDraftCreate
from app.services.admin_question_service import create_question_draft

app = FastAPI()
app.include_router(admin.router, prefix="/admin")


@pytest.fixture
def engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @sa.event.listens_for(engine, "connect")
    def enable_foreign_keys(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    SQLModel.metadata.create_all(
        engine,
        tables=[
            User.__table__,
            Certification.__table__,
            Category.__table__,
            Question.__table__,
            QuestionVersion.__table__,
            AnswerOption.__table__,
            TextAnswerKey.__table__,
        ],
    )

    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture
def session(engine) -> Iterator[Session]:
    with Session(engine) as database_session:
        yield database_session


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
        email=f"{uuid4()}@example.test",
        role=role,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def auth_header(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(str(user.id))}"}


def seed_scope(session: Session) -> tuple[Certification, Category]:
    certification = Certification(
        name="Example Certification",
        code=f"CERT-{uuid4().hex[:8]}",
    )
    session.add(certification)
    session.flush()

    category = Category(
        certification_id=certification.id,
        name="Example Category",
    )
    session.add(category)
    session.commit()
    return certification, category


def create_draft(
    session: Session,
    *,
    owner: User,
    certification: Certification,
    category: Category,
):
    payload = QuestionDraftCreate.model_validate(
        {
            "certification_id": certification.id,
            "category_id": category.id,
            "difficulty": "medium",
            "question_text": "Question to retire",
            "question_type": "multiple_choice",
            "explanation": "Explanation",
            "options": [
                {"option_text": "Correct", "is_correct": True},
                {"option_text": "Incorrect", "is_correct": False},
            ],
        }
    )
    return create_question_draft(session, payload, actor_id=owner.id)


def create_active_question(
    session: Session,
    *,
    owner: User,
    reviewer: User,
    certification: Certification,
    category: Category,
):
    created = create_draft(
        session,
        owner=owner,
        certification=certification,
        category=category,
    )
    reviewer_id = reviewer.id
    version = session.get(QuestionVersion, created.question_version_id)
    assert version is not None
    version.reviewed_by_id = reviewer_id
    version.reviewed_at = datetime.now(UTC)
    version.review_status = "approved"
    version.publication_status = "active"
    session.add(version)
    session.commit()
    return created


def test_administrator_can_retire_active_question(
    client: TestClient,
    session: Session,
):
    administrator = create_user(session, UserRole.ADMINISTRATOR)
    contributor = create_user(session, UserRole.CONTRIBUTOR)
    certification, category = seed_scope(session)
    created = create_active_question(
        session,
        owner=contributor,
        reviewer=administrator,
        certification=certification,
        category=category,
    )

    response = client.post(
        f"/admin/questions/{created.question_id}/retire",
        headers=auth_header(administrator),
        json={"confirm": True},
    )

    assert response.status_code == 200
    assert response.json() == {
        "question_id": str(created.question_id),
        "retired_version_ids": [str(created.question_version_id)],
        "publication_status": "retired",
        "already_retired": False,
    }
    version = session.get(QuestionVersion, created.question_version_id)
    assert version is not None
    assert version.publication_status == "retired"


def test_contributor_cannot_retire_independently(
    client: TestClient,
    session: Session,
):
    administrator = create_user(session, UserRole.ADMINISTRATOR)
    contributor = create_user(session, UserRole.CONTRIBUTOR)
    certification, category = seed_scope(session)
    created = create_active_question(
        session,
        owner=contributor,
        reviewer=administrator,
        certification=certification,
        category=category,
    )

    response = client.post(
        f"/admin/questions/{created.question_id}/retire",
        headers=auth_header(contributor),
        json={"confirm": True},
    )

    assert response.status_code == 403
    version = session.get(QuestionVersion, created.question_version_id)
    assert version is not None
    assert version.publication_status == "active"


def test_learner_cannot_retire_question(
    client: TestClient,
    session: Session,
):
    administrator = create_user(session, UserRole.ADMINISTRATOR)
    contributor = create_user(session, UserRole.CONTRIBUTOR)
    learner = create_user(session, UserRole.LEARNER)
    certification, category = seed_scope(session)
    created = create_active_question(
        session,
        owner=contributor,
        reviewer=administrator,
        certification=certification,
        category=category,
    )

    response = client.post(
        f"/admin/questions/{created.question_id}/retire",
        headers=auth_header(learner),
        json={"confirm": True},
    )

    assert response.status_code == 403
    version = session.get(QuestionVersion, created.question_version_id)
    assert version is not None
    assert version.publication_status == "active"


def test_unauthenticated_retirement_is_rejected(
    client: TestClient,
    session: Session,
):
    administrator = create_user(session, UserRole.ADMINISTRATOR)
    contributor = create_user(session, UserRole.CONTRIBUTOR)
    certification, category = seed_scope(session)
    created = create_active_question(
        session,
        owner=contributor,
        reviewer=administrator,
        certification=certification,
        category=category,
    )

    response = client.post(
        f"/admin/questions/{created.question_id}/retire",
        json={"confirm": True},
    )

    assert response.status_code == 401


def test_retirement_requires_explicit_confirmation(
    client: TestClient,
    session: Session,
):
    administrator = create_user(session, UserRole.ADMINISTRATOR)
    contributor = create_user(session, UserRole.CONTRIBUTOR)
    certification, category = seed_scope(session)
    created = create_active_question(
        session,
        owner=contributor,
        reviewer=administrator,
        certification=certification,
        category=category,
    )

    response = client.post(
        f"/admin/questions/{created.question_id}/retire",
        headers=auth_header(administrator),
        json={"confirm": False},
    )

    assert response.status_code == 422
    version = session.get(QuestionVersion, created.question_version_id)
    assert version is not None
    assert version.publication_status == "active"


def test_draft_only_question_returns_conflict_without_mutation(
    client: TestClient,
    session: Session,
):
    administrator = create_user(session, UserRole.ADMINISTRATOR)
    contributor = create_user(session, UserRole.CONTRIBUTOR)
    certification, category = seed_scope(session)
    created = create_draft(
        session,
        owner=contributor,
        certification=certification,
        category=category,
    )

    response = client.post(
        f"/admin/questions/{created.question_id}/retire",
        headers=auth_header(administrator),
        json={"confirm": True},
    )

    assert response.status_code == 409
    assert response.json() == {
        "detail": "Only active published questions can be retired"
    }
    version = session.get(QuestionVersion, created.question_version_id)
    assert version is not None
    assert version.publication_status == "draft"


def test_missing_question_returns_not_found(
    client: TestClient,
    session: Session,
):
    administrator = create_user(session, UserRole.ADMINISTRATOR)

    response = client.post(
        f"/admin/questions/{uuid4()}/retire",
        headers=auth_header(administrator),
        json={"confirm": True},
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "Question not found"}


def test_repeat_retirement_is_idempotent(
    client: TestClient,
    session: Session,
):
    administrator = create_user(session, UserRole.ADMINISTRATOR)
    contributor = create_user(session, UserRole.CONTRIBUTOR)
    certification, category = seed_scope(session)
    created = create_active_question(
        session,
        owner=contributor,
        reviewer=administrator,
        certification=certification,
        category=category,
    )
    url = f"/admin/questions/{created.question_id}/retire"
    headers = auth_header(administrator)

    first = client.post(url, headers=headers, json={"confirm": True})
    second = client.post(url, headers=headers, json={"confirm": True})

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["already_retired"] is False
    assert second.json()["already_retired"] is True
    assert second.json()["retired_version_ids"] == first.json()["retired_version_ids"]
