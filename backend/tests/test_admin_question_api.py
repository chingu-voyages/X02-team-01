from collections.abc import Iterator
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

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
    token = create_access_token(str(user.id))
    return {"Authorization": f"Bearer {token}"}


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


def create_payload(
    certification_id: UUID,
    category_id: UUID,
) -> dict[str, object]:
    return {
        "certification_id": str(certification_id),
        "category_id": str(category_id),
        "difficulty": "medium",
        "question_text": "Which statement is correct?",
        "question_type": "multiple_choice",
        "allows_multiple_answers": False,
        "explanation": "The first answer is correct.",
        "options": [
            {"option_text": "Correct", "is_correct": True},
            {"option_text": "Incorrect", "is_correct": False},
        ],
    }


@pytest.mark.parametrize(
    ("role", "expected_status"),
    [
        (UserRole.LEARNER, 403),
        (UserRole.CONTRIBUTOR, 201),
        (UserRole.ADMINISTRATOR, 201),
    ],
)
def test_create_question_role_matrix(
    client: TestClient,
    session: Session,
    role: UserRole,
    expected_status: int,
):
    user = create_user(session, role)
    certification, category = seed_scope(session)

    response = client.post(
        "/admin/questions",
        json=create_payload(certification.id, category.id),
        headers=auth_header(user),
    )

    assert response.status_code == expected_status

    questions = session.exec(select(Question)).all()
    if expected_status == 403:
        assert questions == []
        return

    assert len(questions) == 1
    assert questions[0].created_by_id == user.id

    body = response.json()
    assert body["version_number"] == 1
    assert body["review_status"] == "pending"
    assert body["publication_status"] == "draft"


def test_unauthenticated_create_is_rejected_without_writes(
    client: TestClient,
    session: Session,
):
    certification, category = seed_scope(session)

    response = client.post(
        "/admin/questions",
        json=create_payload(certification.id, category.id),
    )

    assert response.status_code == 401
    assert session.exec(select(Question)).all() == []


def test_invalid_category_scope_returns_actionable_error_without_writes(
    client: TestClient,
    session: Session,
):
    contributor = create_user(session, UserRole.CONTRIBUTOR)
    certification, _category = seed_scope(session)

    other_certification = Certification(
        name="Other Certification",
        code=f"OTHER-{uuid4().hex[:8]}",
    )
    session.add(other_certification)
    session.flush()

    other_category = Category(
        certification_id=other_certification.id,
        name="Other Category",
    )
    session.add(other_category)
    session.commit()

    response = client.post(
        "/admin/questions",
        json=create_payload(certification.id, other_category.id),
        headers=auth_header(contributor),
    )

    assert response.status_code == 422
    assert response.json() == {
        "detail": "Category does not belong to the selected certification"
    }
    assert session.exec(select(Question)).all() == []
    assert session.exec(select(QuestionVersion)).all() == []


def test_client_cannot_override_workflow_state(
    client: TestClient,
    session: Session,
):
    contributor = create_user(session, UserRole.CONTRIBUTOR)
    certification, category = seed_scope(session)
    payload = create_payload(certification.id, category.id)
    payload["publication_status"] = "active"
    payload["review_status"] = "approved"

    response = client.post(
        "/admin/questions",
        json=payload,
        headers=auth_header(contributor),
    )

    assert response.status_code == 422
    assert session.exec(select(Question)).all() == []
