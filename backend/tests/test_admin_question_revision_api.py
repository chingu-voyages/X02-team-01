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
from app.models.question_image import QuestionImage
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
            QuestionImage.__table__,
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


def create_active_question(
    session: Session,
    *,
    owner: User,
    reviewer: User,
    certification: Certification,
    category: Category,
):
    payload = QuestionDraftCreate.model_validate(
        {
            "certification_id": certification.id,
            "category_id": category.id,
            "difficulty": "medium",
            "question_text": "Published question",
            "question_type": "multiple_choice",
            "explanation": "Published explanation",
            "options": [
                {"option_text": "Published correct", "is_correct": True},
                {"option_text": "Published incorrect", "is_correct": False},
            ],
        }
    )
    created = create_question_draft(session, payload, actor_id=owner.id)
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


def revision_payload(category: Category) -> dict[str, object]:
    return {
        "category_id": str(category.id),
        "difficulty": "medium",
        "question_text": "Revised question",
        "question_type": "multiple_choice",
        "allows_multiple_answers": False,
        "explanation": "Revised explanation",
        "options": [
            {"option_text": "Revised correct", "is_correct": True},
            {"option_text": "Revised incorrect", "is_correct": False},
        ],
    }


def test_administrator_revision_creates_new_draft_and_preserves_active(
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

    response = client.patch(
        f"/admin/questions/{created.question_id}",
        headers=auth_header(administrator),
        json=revision_payload(category),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["version_number"] == 2
    assert body["question_text"] == "Revised question"
    assert body["review_status"] == "pending"
    assert body["publication_status"] == "draft"
    assert body["submitted_by_id"] == str(administrator.id)

    versions = session.exec(
        select(QuestionVersion)
        .where(QuestionVersion.question_id == created.question_id)
        .order_by(QuestionVersion.version_number)
    ).all()
    assert len(versions) == 2
    assert versions[0].id == created.question_version_id
    assert versions[0].question_text == "Published question"
    assert versions[0].review_status == "approved"
    assert versions[0].publication_status == "active"
    assert versions[1].question_text == "Revised question"
    assert versions[1].review_status == "pending"
    assert versions[1].publication_status == "draft"


def test_revision_answer_options_belong_only_to_new_version(
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

    response = client.patch(
        f"/admin/questions/{created.question_id}",
        headers=auth_header(administrator),
        json=revision_payload(category),
    )
    assert response.status_code == 200

    versions = session.exec(
        select(QuestionVersion)
        .where(QuestionVersion.question_id == created.question_id)
        .order_by(QuestionVersion.version_number)
    ).all()
    old_options = session.exec(
        select(AnswerOption)
        .where(AnswerOption.question_version_id == versions[0].id)
        .order_by(AnswerOption.position)
    ).all()
    new_options = session.exec(
        select(AnswerOption)
        .where(AnswerOption.question_version_id == versions[1].id)
        .order_by(AnswerOption.position)
    ).all()

    assert [item.option_text for item in old_options] == [
        "Published correct",
        "Published incorrect",
    ]
    assert [item.option_text for item in new_options] == [
        "Revised correct",
        "Revised incorrect",
    ]


def test_revision_copies_version_pinned_images(
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
    session.add(
        QuestionImage(
            question_version_id=created.question_version_id,
            storage_key="questions/example.png",
            alt_text="Example diagram",
            media_type="image/png",
            position=1,
        )
    )
    session.commit()

    response = client.patch(
        f"/admin/questions/{created.question_id}",
        headers=auth_header(administrator),
        json=revision_payload(category),
    )
    assert response.status_code == 200

    versions = session.exec(
        select(QuestionVersion)
        .where(QuestionVersion.question_id == created.question_id)
        .order_by(QuestionVersion.version_number)
    ).all()
    original_images = session.exec(
        select(QuestionImage).where(QuestionImage.question_version_id == versions[0].id)
    ).all()
    revision_images = session.exec(
        select(QuestionImage).where(QuestionImage.question_version_id == versions[1].id)
    ).all()

    assert len(original_images) == 1
    assert len(revision_images) == 1
    assert revision_images[0].storage_key == original_images[0].storage_key
    assert revision_images[0].alt_text == original_images[0].alt_text
    assert revision_images[0].media_type == original_images[0].media_type
    assert revision_images[0].position == original_images[0].position


def test_published_revision_cannot_change_parent_scope(
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
    payload = revision_payload(category)
    payload["difficulty"] = "hard"

    response = client.patch(
        f"/admin/questions/{created.question_id}",
        headers=auth_header(administrator),
        json=payload,
    )

    assert response.status_code == 422
    assert response.json() == {
        "detail": "Published revisions cannot change category or difficulty"
    }
    versions = session.exec(
        select(QuestionVersion).where(
            QuestionVersion.question_id == created.question_id
        )
    ).all()
    assert len(versions) == 1
    assert versions[0].publication_status == "active"


def test_new_revision_is_not_learner_eligible_until_approved(
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

    response = client.patch(
        f"/admin/questions/{created.question_id}",
        headers=auth_header(administrator),
        json=revision_payload(category),
    )
    assert response.status_code == 200

    versions = session.exec(
        select(QuestionVersion)
        .where(QuestionVersion.question_id == created.question_id)
        .order_by(QuestionVersion.version_number)
    ).all()
    active = [version for version in versions if version.publication_status == "active"]
    drafts = [version for version in versions if version.publication_status == "draft"]
    assert len(active) == 1
    assert active[0].id == created.question_version_id
    assert active[0].review_status == "approved"
    assert len(drafts) == 1
    assert drafts[0].version_number == 2
    assert drafts[0].review_status == "pending"
