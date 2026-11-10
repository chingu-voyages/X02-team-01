from collections.abc import Iterator
from datetime import UTC, datetime
from uuid import uuid4

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
    user = User(email=f"{uuid4()}@example.test", role=role)
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


def seed_other_category(session: Session) -> Category:
    certification = Certification(
        name="Other Certification",
        code=f"OTHER-{uuid4().hex[:8]}",
    )
    session.add(certification)
    session.flush()
    category = Category(
        certification_id=certification.id,
        name="Other Category",
    )
    session.add(category)
    session.commit()
    return category


def create_mc_draft(
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
            "question_text": "Original question",
            "question_type": "multiple_choice",
            "explanation": "Original explanation",
            "options": [
                {"option_text": "Original correct", "is_correct": True},
                {"option_text": "Original incorrect", "is_correct": False},
            ],
        }
    )
    return create_question_draft(session, payload, actor_id=owner.id)


def edit_mc_payload(category: Category | None = None) -> dict[str, object]:
    return {
        "category_id": str(category.id) if category is not None else None,
        "difficulty": "hard",
        "question_text": "Updated draft question",
        "question_type": "multiple_choice",
        "allows_multiple_answers": True,
        "explanation": "Updated explanation",
        "options": [
            {"option_text": "New first", "is_correct": True},
            {"option_text": "New second", "is_correct": True},
            {"option_text": "New third", "is_correct": False},
        ],
    }


def test_contributor_can_edit_owned_draft_in_place(
    client: TestClient,
    session: Session,
):
    contributor = create_user(session, UserRole.CONTRIBUTOR)
    certification, category = seed_scope(session)
    created = create_mc_draft(
        session,
        owner=contributor,
        certification=certification,
        category=category,
    )

    response = client.patch(
        f"/admin/questions/{created.question_id}",
        headers=auth_header(contributor),
        json=edit_mc_payload(category),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["question_version_id"] == str(created.question_version_id)
    assert body["version_number"] == 1
    assert body["question_text"] == "Updated draft question"
    assert body["difficulty"] == "hard"
    assert body["review_status"] == "pending"
    assert body["publication_status"] == "draft"
    assert body["submitted_by_id"] == str(contributor.id)
    assert body["options"] == [
        {"position": 1, "option_text": "New first", "is_correct": True},
        {"position": 2, "option_text": "New second", "is_correct": True},
        {"position": 3, "option_text": "New third", "is_correct": False},
    ]


def test_administrator_can_edit_contributor_draft(
    client: TestClient,
    session: Session,
):
    administrator = create_user(session, UserRole.ADMINISTRATOR)
    contributor = create_user(session, UserRole.CONTRIBUTOR)
    certification, category = seed_scope(session)
    created = create_mc_draft(
        session,
        owner=contributor,
        certification=certification,
        category=category,
    )

    response = client.patch(
        f"/admin/questions/{created.question_id}",
        headers=auth_header(administrator),
        json=edit_mc_payload(category),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["created_by_id"] == str(contributor.id)
    assert body["submitted_by_id"] == str(administrator.id)
    assert body["review_status"] == "pending"
    assert body["publication_status"] == "draft"


def test_contributor_cannot_edit_another_contributors_question(
    client: TestClient,
    session: Session,
):
    contributor = create_user(session, UserRole.CONTRIBUTOR)
    owner = create_user(session, UserRole.CONTRIBUTOR)
    certification, category = seed_scope(session)
    created = create_mc_draft(
        session,
        owner=owner,
        certification=certification,
        category=category,
    )

    response = client.patch(
        f"/admin/questions/{created.question_id}",
        headers=auth_header(contributor),
        json=edit_mc_payload(category),
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "Question not found"}
    version = session.get(QuestionVersion, created.question_version_id)
    assert version is not None
    assert version.question_text == "Original question"


def test_learner_cannot_edit_draft(
    client: TestClient,
    session: Session,
):
    learner = create_user(session, UserRole.LEARNER)
    owner = create_user(session, UserRole.CONTRIBUTOR)
    certification, category = seed_scope(session)
    created = create_mc_draft(
        session,
        owner=owner,
        certification=certification,
        category=category,
    )

    response = client.patch(
        f"/admin/questions/{created.question_id}",
        headers=auth_header(learner),
        json=edit_mc_payload(category),
    )

    assert response.status_code == 403
    version = session.get(QuestionVersion, created.question_version_id)
    assert version is not None
    assert version.question_text == "Original question"


def test_edit_can_switch_multiple_choice_to_short_answer_atomically(
    client: TestClient,
    session: Session,
):
    contributor = create_user(session, UserRole.CONTRIBUTOR)
    certification, category = seed_scope(session)
    created = create_mc_draft(
        session,
        owner=contributor,
        certification=certification,
        category=category,
    )

    response = client.patch(
        f"/admin/questions/{created.question_id}",
        headers=auth_header(contributor),
        json={
            "category_id": str(category.id),
            "difficulty": "easy",
            "question_text": "What does MVP stand for?",
            "question_type": "short_answer",
            "explanation": "Expanded form",
            "expected_answer": "Minimum Viable Product",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["question_type"] == "short_answer"
    assert body["options"] == []
    assert body["expected_answer"] == "Minimum Viable Product"
    assert session.exec(select(AnswerOption)).all() == []
    keys = session.exec(select(TextAnswerKey)).all()
    assert len(keys) == 1
    assert keys[0].question_version_id == created.question_version_id


def test_invalid_category_scope_does_not_mutate_draft(
    client: TestClient,
    session: Session,
):
    contributor = create_user(session, UserRole.CONTRIBUTOR)
    certification, category = seed_scope(session)
    created = create_mc_draft(
        session,
        owner=contributor,
        certification=certification,
        category=category,
    )
    other_category = seed_other_category(session)

    response = client.patch(
        f"/admin/questions/{created.question_id}",
        headers=auth_header(contributor),
        json=edit_mc_payload(other_category),
    )

    assert response.status_code == 422
    assert response.json() == {
        "detail": "Category does not belong to the selected certification"
    }
    question = session.get(Question, created.question_id)
    version = session.get(QuestionVersion, created.question_version_id)
    assert question is not None
    assert version is not None
    assert question.category_id == category.id
    assert question.difficulty == "medium"
    assert version.question_text == "Original question"


def test_client_cannot_override_workflow_status_during_edit(
    client: TestClient,
    session: Session,
):
    contributor = create_user(session, UserRole.CONTRIBUTOR)
    certification, category = seed_scope(session)
    created = create_mc_draft(
        session,
        owner=contributor,
        certification=certification,
        category=category,
    )
    payload = edit_mc_payload(category)
    payload["publication_status"] = "active"
    payload["review_status"] = "approved"

    response = client.patch(
        f"/admin/questions/{created.question_id}",
        headers=auth_header(contributor),
        json=payload,
    )

    assert response.status_code == 422
    version = session.get(QuestionVersion, created.question_version_id)
    assert version is not None
    assert version.review_status == "pending"
    assert version.publication_status == "draft"
    assert version.question_text == "Original question"


def test_active_question_is_not_edited_in_place(
    client: TestClient,
    session: Session,
):
    administrator = create_user(
        session,
        UserRole.ADMINISTRATOR,
    )

    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )

    # Cache the UUID before later commits can expire the ORM object.
    administrator_id = administrator.id

    certification, category = seed_scope(session)

    created = create_mc_draft(
        session,
        owner=contributor,
        certification=certification,
        category=category,
    )

    version = session.get(
        QuestionVersion,
        created.question_version_id,
    )

    assert version is not None

    version.reviewed_by_id = administrator_id
    version.reviewed_at = datetime.now(UTC)
    version.review_status = "approved"
    version.publication_status = "active"

    session.add(version)
    session.commit()

    response = client.patch(
        f"/admin/questions/{created.question_id}",
        headers=auth_header(administrator),
        json=edit_mc_payload(category),
    )

    assert response.status_code == 409
    assert response.json() == {"detail": "Only draft questions can be edited directly"}

    session.refresh(version)

    assert version.question_text == "Original question"
    assert version.review_status == "approved"
    assert version.publication_status == "active"


def test_missing_question_returns_not_found(
    client: TestClient,
    session: Session,
):
    administrator = create_user(session, UserRole.ADMINISTRATOR)
    _certification, category = seed_scope(session)

    response = client.patch(
        f"/admin/questions/{uuid4()}",
        headers=auth_header(administrator),
        json=edit_mc_payload(category),
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "Question not found"}
