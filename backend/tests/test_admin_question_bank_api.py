from collections.abc import Iterator
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


def mc_payload(
    certification: Certification,
    category: Category,
    *,
    question_text: str,
) -> QuestionDraftCreate:
    return QuestionDraftCreate.model_validate(
        {
            "certification_id": certification.id,
            "category_id": category.id,
            "difficulty": "medium",
            "question_text": question_text,
            "question_type": "multiple_choice",
            "allows_multiple_answers": False,
            "explanation": "Management explanation",
            "options": [
                {"option_text": "Correct", "is_correct": True},
                {"option_text": "Incorrect", "is_correct": False},
            ],
        }
    )


def seed_question(
    session: Session,
    *,
    owner: User,
    certification: Certification,
    category: Category,
    question_text: str,
):
    return create_question_draft(
        session,
        mc_payload(
            certification,
            category,
            question_text=question_text,
        ),
        actor_id=owner.id,
    )


def test_empty_question_bank_returns_explicit_empty_state(
    client: TestClient,
    session: Session,
):
    administrator = create_user(session, UserRole.ADMINISTRATOR)

    response = client.get(
        "/admin/questions",
        headers=auth_header(administrator),
    )

    assert response.status_code == 200
    assert response.json() == {"items": [], "count": 0}


def test_learner_cannot_access_question_bank(
    client: TestClient,
    session: Session,
):
    learner = create_user(session, UserRole.LEARNER)

    response = client.get(
        "/admin/questions",
        headers=auth_header(learner),
    )

    assert response.status_code == 403
    assert response.json() == {"detail": "Insufficient permissions"}


def test_contributor_list_contains_only_owned_questions(
    client: TestClient,
    session: Session,
):
    contributor = create_user(session, UserRole.CONTRIBUTOR)
    other_contributor = create_user(session, UserRole.CONTRIBUTOR)
    certification, category = seed_scope(session)

    own = seed_question(
        session,
        owner=contributor,
        certification=certification,
        category=category,
        question_text="Contributor-owned question",
    )
    seed_question(
        session,
        owner=other_contributor,
        certification=certification,
        category=category,
        question_text="Another contributor's question",
    )

    response = client.get(
        "/admin/questions",
        headers=auth_header(contributor),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    assert body["items"][0]["question_id"] == str(own.question_id)
    assert body["items"][0]["question_preview"] == "Contributor-owned question"
    assert body["items"][0]["certification_name"] == "Example Certification"
    assert body["items"][0]["category_name"] == "Example Category"
    assert body["items"][0]["review_status"] == "pending"
    assert body["items"][0]["publication_status"] == "draft"
    assert body["items"][0]["last_updated"] is not None


def test_administrator_list_contains_all_questions(
    client: TestClient,
    session: Session,
):
    administrator = create_user(session, UserRole.ADMINISTRATOR)
    first_contributor = create_user(session, UserRole.CONTRIBUTOR)
    second_contributor = create_user(session, UserRole.CONTRIBUTOR)
    certification, category = seed_scope(session)

    seed_question(
        session,
        owner=first_contributor,
        certification=certification,
        category=category,
        question_text="First question",
    )
    seed_question(
        session,
        owner=second_contributor,
        certification=certification,
        category=category,
        question_text="Second question",
    )

    response = client.get(
        "/admin/questions",
        headers=auth_header(administrator),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 2
    assert {item["question_preview"] for item in body["items"]} == {
        "First question",
        "Second question",
    }


def test_contributor_can_view_owned_question_detail_with_answer_configuration(
    client: TestClient,
    session: Session,
):
    contributor = create_user(session, UserRole.CONTRIBUTOR)
    certification, category = seed_scope(session)
    created = seed_question(
        session,
        owner=contributor,
        certification=certification,
        category=category,
        question_text="Detail question",
    )

    response = client.get(
        f"/admin/questions/{created.question_id}",
        headers=auth_header(contributor),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["question_text"] == "Detail question"
    assert body["question_type"] == "multiple_choice"
    assert body["explanation"] == "Management explanation"
    assert body["version_number"] == 1
    assert body["created_by_id"] == str(contributor.id)
    assert body["options"] == [
        {"position": 1, "option_text": "Correct", "is_correct": True},
        {"position": 2, "option_text": "Incorrect", "is_correct": False},
    ]
    assert body["expected_answer"] is None


def test_contributor_cannot_probe_another_contributors_question(
    client: TestClient,
    session: Session,
):
    contributor = create_user(session, UserRole.CONTRIBUTOR)
    other_contributor = create_user(session, UserRole.CONTRIBUTOR)
    certification, category = seed_scope(session)
    foreign = seed_question(
        session,
        owner=other_contributor,
        certification=certification,
        category=category,
        question_text="Foreign question",
    )

    response = client.get(
        f"/admin/questions/{foreign.question_id}",
        headers=auth_header(contributor),
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "Question not found"}


def test_administrator_can_view_contributor_question_detail(
    client: TestClient,
    session: Session,
):
    administrator = create_user(session, UserRole.ADMINISTRATOR)
    contributor = create_user(session, UserRole.CONTRIBUTOR)
    certification, category = seed_scope(session)
    created = seed_question(
        session,
        owner=contributor,
        certification=certification,
        category=category,
        question_text="Administrator-visible question",
    )

    response = client.get(
        f"/admin/questions/{created.question_id}",
        headers=auth_header(administrator),
    )

    assert response.status_code == 200
    assert response.json()["question_text"] == "Administrator-visible question"


def test_question_bank_uses_latest_version_for_list_and_detail(
    client: TestClient,
    session: Session,
):
    administrator = create_user(session, UserRole.ADMINISTRATOR)
    contributor = create_user(session, UserRole.CONTRIBUTOR)
    certification, category = seed_scope(session)
    created = seed_question(
        session,
        owner=contributor,
        certification=certification,
        category=category,
        question_text="Original version",
    )

    second_version = QuestionVersion(
        question_id=created.question_id,
        version_number=2,
        question_text="Latest draft version",
        question_type="multiple_choice",
        allows_multiple_answers=False,
        explanation="Updated explanation",
        review_status="pending",
        publication_status="draft",
        is_flagged=False,
        submitted_by_id=administrator.id,
    )
    session.add(second_version)
    session.flush()
    session.add_all(
        [
            AnswerOption(
                question_version_id=second_version.id,
                option_text="New correct",
                is_correct=True,
                position=1,
            ),
            AnswerOption(
                question_version_id=second_version.id,
                option_text="New incorrect",
                is_correct=False,
                position=2,
            ),
        ]
    )
    session.commit()

    list_response = client.get(
        "/admin/questions",
        headers=auth_header(administrator),
    )
    detail_response = client.get(
        f"/admin/questions/{created.question_id}",
        headers=auth_header(administrator),
    )

    assert list_response.status_code == 200
    assert list_response.json()["items"][0]["version_number"] == 2
    assert list_response.json()["items"][0]["question_preview"] == (
        "Latest draft version"
    )

    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["version_number"] == 2
    assert detail["question_text"] == "Latest draft version"
    assert detail["options"][0]["option_text"] == "New correct"
