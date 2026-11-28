from collections.abc import Iterator
from io import BytesIO
from uuid import uuid4

import pytest
import sqlalchemy as sa
from admin_auth_fixtures import domain_access_token, make_domain_user
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.api.v1.endpoints import admin
from app.core.config import settings
from app.core.roles import UserRole
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
from app.services.admin_question_service import (
    create_question_draft,
    publish_question_draft,
)
from app.services.r2_storage import R2StorageError

app = FastAPI()
app.include_router(
    admin.router,
    prefix="/admin",
)


class FakeR2Storage:
    def __init__(self) -> None:
        self.upload_calls: list[dict[str, object]] = []
        self.delete_calls: list[str] = []

    def upload(
        self,
        *,
        key: str,
        content: bytes,
        media_type: str,
    ) -> None:
        self.upload_calls.append(
            {
                "key": key,
                "content": content,
                "media_type": media_type,
            }
        )

    def delete(
        self,
        *,
        key: str,
    ) -> None:
        self.delete_calls.append(key)


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
def session(
    engine,
) -> Iterator[Session]:
    with Session(engine) as database_session:
        yield database_session


@pytest.fixture
def storage() -> FakeR2Storage:
    return FakeR2Storage()


@pytest.fixture
def client(
    session: Session,
    storage: FakeR2Storage,
) -> Iterator[TestClient]:
    def override_session() -> Iterator[Session]:
        yield session

    def override_storage():
        return storage

    app.dependency_overrides[get_session] = override_session

    app.dependency_overrides[admin.get_r2_storage] = override_storage

    try:
        with TestClient(app) as test_client:
            yield test_client

    finally:
        app.dependency_overrides.clear()


def create_user(
    session: Session,
    role: UserRole,
) -> User:
    user = make_domain_user(
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
    return {"Authorization": (f"Bearer {domain_access_token(user)}")}


def seed_scope(
    session: Session,
) -> tuple[
    Certification,
    Category,
]:
    certification = Certification(
        name="Example Certification",
        code=(f"CERT-{uuid4().hex[:8]}"),
    )

    session.add(certification)
    session.flush()

    category = Category(
        certification_id=(certification.id),
        name="Example Category",
    )

    session.add(category)
    session.commit()

    return (
        certification,
        category,
    )


def create_mc_draft(
    session: Session,
    *,
    owner: User,
    certification: Certification,
    category: Category,
):
    payload = QuestionDraftCreate.model_validate(
        {
            "certification_id": (certification.id),
            "category_id": (category.id),
            "difficulty": "medium",
            "question_text": ("Question with optional diagram"),
            "question_type": ("multiple_choice"),
            "explanation": ("Explanation"),
            "options": [
                {
                    "option_text": ("Correct"),
                    "is_correct": True,
                },
                {
                    "option_text": ("Incorrect"),
                    "is_correct": False,
                },
            ],
        }
    )

    return create_question_draft(
        session,
        payload,
        actor_id=owner.id,
    )


def publish_question(
    session: Session,
    *,
    question_id,
    administrator: User,
) -> None:
    publish_question_draft(
        session,
        question_id,
        actor=administrator,
    )


def image_bytes(
    image_format: str = "PNG",
) -> bytes:
    buffer = BytesIO()

    mode = (
        "RGB"
        if image_format
        in {
            "JPEG",
            "WEBP",
        }
        else "RGBA"
    )

    Image.new(
        mode,
        (8, 8),
        color="white",
    ).save(
        buffer,
        format=image_format,
    )

    return buffer.getvalue()


def upload_image(
    client: TestClient,
    *,
    question_id,
    user: User,
    image_format: str = "PNG",
    alt_text: str = "Example diagram",
):
    extension = {
        "PNG": "png",
        "JPEG": "jpg",
        "WEBP": "webp",
    }[image_format]

    media_type = {
        "PNG": "image/png",
        "JPEG": "image/jpeg",
        "WEBP": "image/webp",
    }[image_format]

    return client.post(
        (f"/admin/questions/{question_id}/images"),
        headers=auth_header(user),
        files={
            "file": (
                f"diagram.{extension}",
                image_bytes(image_format),
                media_type,
            ),
        },
        data={
            "alt_text": alt_text,
        },
    )


def test_contributor_can_upload_image_to_owned_draft(
    client: TestClient,
    session: Session,
    storage: FakeR2Storage,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )

    certification, category = seed_scope(session)

    created = create_mc_draft(
        session,
        owner=contributor,
        certification=certification,
        category=category,
    )

    response = upload_image(
        client,
        question_id=(created.question_id),
        user=contributor,
    )

    assert response.status_code == 201

    body = response.json()

    assert body["question_version_id"] == str(created.question_version_id)

    assert body["position"] == 1

    assert body["alt_text"] == "Example diagram"

    assert body["media_type"] == "image/png"

    assert "storage_key" not in body

    rows = session.exec(select(QuestionImage)).all()

    assert len(rows) == 1

    record = rows[0]

    assert record.question_version_id == created.question_version_id

    assert record.alt_text == "Example diagram"

    assert record.media_type == "image/png"

    assert len(storage.upload_calls) == 1

    upload = storage.upload_calls[0]

    assert upload["key"] == record.storage_key

    assert str(upload["key"]).startswith(f"questions/{created.question_version_id}/")

    assert str(upload["key"]).endswith(".png")

    assert storage.delete_calls == []


def test_administrator_can_upload_to_contributor_draft(
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

    certification, category = seed_scope(session)

    created = create_mc_draft(
        session,
        owner=contributor,
        certification=certification,
        category=category,
    )

    response = upload_image(
        client,
        question_id=(created.question_id),
        user=administrator,
    )

    assert response.status_code == 201

    image = session.exec(select(QuestionImage)).one()

    assert image.question_version_id == created.question_version_id


def test_contributor_cannot_upload_to_another_contributors_question(
    client: TestClient,
    session: Session,
    storage: FakeR2Storage,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )

    owner = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )

    certification, category = seed_scope(session)

    created = create_mc_draft(
        session,
        owner=owner,
        certification=certification,
        category=category,
    )

    response = upload_image(
        client,
        question_id=(created.question_id),
        user=contributor,
    )

    assert response.status_code == 404

    assert session.exec(select(QuestionImage)).all() == []

    assert storage.upload_calls == []


def test_learner_cannot_upload_question_image(
    client: TestClient,
    session: Session,
    storage: FakeR2Storage,
):
    learner = create_user(
        session,
        UserRole.LEARNER,
    )

    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )

    certification, category = seed_scope(session)

    created = create_mc_draft(
        session,
        owner=contributor,
        certification=certification,
        category=category,
    )

    response = upload_image(
        client,
        question_id=(created.question_id),
        user=learner,
    )

    assert response.status_code == 403

    assert storage.upload_calls == []


def test_second_image_is_rejected_for_mvp(
    client: TestClient,
    session: Session,
    storage: FakeR2Storage,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )

    certification, category = seed_scope(session)

    created = create_mc_draft(
        session,
        owner=contributor,
        certification=certification,
        category=category,
    )

    first = upload_image(
        client,
        question_id=(created.question_id),
        user=contributor,
    )

    assert first.status_code == 201

    second = upload_image(
        client,
        question_id=(created.question_id),
        user=contributor,
    )

    assert second.status_code == 409

    assert len(session.exec(select(QuestionImage)).all()) == 1

    assert len(storage.upload_calls) == 1


def test_gif_upload_is_rejected(
    client: TestClient,
    session: Session,
    storage: FakeR2Storage,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )

    certification, category = seed_scope(session)

    created = create_mc_draft(
        session,
        owner=contributor,
        certification=certification,
        category=category,
    )

    response = client.post(
        (f"/admin/questions/{created.question_id}/images"),
        headers=auth_header(contributor),
        files={
            "file": (
                "diagram.gif",
                b"GIF89a-not-supported",
                "image/gif",
            ),
        },
        data={
            "alt_text": "Diagram",
        },
    )

    assert response.status_code == 415

    assert storage.upload_calls == []


def test_oversized_image_is_rejected(
    client: TestClient,
    session: Session,
    storage: FakeR2Storage,
    monkeypatch,
):
    monkeypatch.setattr(
        settings,
        "max_question_image_bytes",
        16,
    )

    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )

    certification, category = seed_scope(session)

    created = create_mc_draft(
        session,
        owner=contributor,
        certification=certification,
        category=category,
    )

    response = client.post(
        (f"/admin/questions/{created.question_id}/images"),
        headers=auth_header(contributor),
        files={
            "file": (
                "large.png",
                (b"\x89PNG\r\n\x1a\n" + b"x" * 100),
                "image/png",
            ),
        },
        data={
            "alt_text": "Diagram",
        },
    )

    assert response.status_code == 413

    assert storage.upload_calls == []


def test_blank_alt_text_is_rejected(
    client: TestClient,
    session: Session,
    storage: FakeR2Storage,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )

    certification, category = seed_scope(session)

    created = create_mc_draft(
        session,
        owner=contributor,
        certification=certification,
        category=category,
    )

    response = client.post(
        (f"/admin/questions/{created.question_id}/images"),
        headers=auth_header(contributor),
        files={
            "file": (
                "diagram.png",
                image_bytes("PNG"),
                "image/png",
            ),
        },
        data={
            "alt_text": "   ",
        },
    )

    assert response.status_code == 422

    assert storage.upload_calls == []


def test_contributor_cannot_change_image_on_published_question(
    client: TestClient,
    session: Session,
    storage: FakeR2Storage,
):
    administrator = create_user(
        session,
        UserRole.ADMINISTRATOR,
    )

    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )

    certification, category = seed_scope(session)

    created = create_mc_draft(
        session,
        owner=contributor,
        certification=certification,
        category=category,
    )

    publish_question(
        session,
        question_id=(created.question_id),
        administrator=administrator,
    )

    response = upload_image(
        client,
        question_id=(created.question_id),
        user=contributor,
    )

    assert response.status_code == 403

    versions = session.exec(
        select(QuestionVersion).where(
            QuestionVersion.question_id == created.question_id
        )
    ).all()

    assert len(versions) == 1

    assert versions[0].publication_status == "active"

    assert storage.upload_calls == []


def test_administrator_image_change_on_published_question_creates_draft_revision(
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

    certification, category = seed_scope(session)

    created = create_mc_draft(
        session,
        owner=contributor,
        certification=certification,
        category=category,
    )

    publish_question(
        session,
        question_id=(created.question_id),
        administrator=administrator,
    )

    response = upload_image(
        client,
        question_id=(created.question_id),
        user=administrator,
    )

    assert response.status_code == 201

    versions = session.exec(
        select(QuestionVersion)
        .where(QuestionVersion.question_id == created.question_id)
        .order_by(QuestionVersion.version_number)
    ).all()

    assert len(versions) == 2

    assert versions[0].id == created.question_version_id

    assert versions[0].publication_status == "active"

    assert versions[0].review_status == "approved"

    assert versions[1].version_number == 2

    assert versions[1].publication_status == "draft"

    assert versions[1].review_status == "pending"

    images = session.exec(select(QuestionImage)).all()

    assert len(images) == 1

    assert images[0].question_version_id == versions[1].id


def test_replace_image_uses_new_immutable_key(
    client: TestClient,
    session: Session,
    storage: FakeR2Storage,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )

    certification, category = seed_scope(session)

    created = create_mc_draft(
        session,
        owner=contributor,
        certification=certification,
        category=category,
    )

    created_response = upload_image(
        client,
        question_id=(created.question_id),
        user=contributor,
    )

    assert created_response.status_code == 201

    image_id = created_response.json()["id"]

    before = session.exec(select(QuestionImage)).one()

    old_key = before.storage_key

    response = client.patch(
        (f"/admin/questions/{created.question_id}/images/{image_id}"),
        headers=auth_header(contributor),
        files={
            "file": (
                "replacement.jpg",
                image_bytes("JPEG"),
                "image/jpeg",
            ),
        },
        data={
            "alt_text": ("Replacement diagram"),
        },
    )

    assert response.status_code == 200

    after = session.exec(select(QuestionImage)).one()

    assert after.id == before.id

    assert after.storage_key != old_key

    assert after.storage_key.endswith(".jpg")

    assert after.alt_text == "Replacement diagram"

    assert after.media_type == "image/jpeg"

    assert len(storage.upload_calls) == 2

    assert old_key in storage.delete_calls


def test_replace_published_image_preserves_active_version_asset(
    client: TestClient,
    session: Session,
    storage: FakeR2Storage,
):
    administrator = create_user(
        session,
        UserRole.ADMINISTRATOR,
    )

    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )

    certification, category = seed_scope(session)

    created = create_mc_draft(
        session,
        owner=contributor,
        certification=certification,
        category=category,
    )

    old_image = QuestionImage(
        question_version_id=(created.question_version_id),
        storage_key=("questions/original/diagram.png"),
        alt_text=("Original diagram"),
        media_type="image/png",
        position=1,
    )

    session.add(old_image)
    session.commit()
    session.refresh(old_image)

    publish_question(
        session,
        question_id=(created.question_id),
        administrator=administrator,
    )

    response = client.patch(
        (f"/admin/questions/{created.question_id}/images/{old_image.id}"),
        headers=auth_header(administrator),
        files={
            "file": (
                "replacement.webp",
                image_bytes("WEBP"),
                "image/webp",
            ),
        },
        data={
            "alt_text": ("Updated diagram"),
        },
    )

    assert response.status_code == 200

    versions = session.exec(
        select(QuestionVersion)
        .where(QuestionVersion.question_id == created.question_id)
        .order_by(QuestionVersion.version_number)
    ).all()

    assert len(versions) == 2

    active_image = session.exec(
        select(QuestionImage).where(QuestionImage.question_version_id == versions[0].id)
    ).one()

    draft_image = session.exec(
        select(QuestionImage).where(QuestionImage.question_version_id == versions[1].id)
    ).one()

    assert active_image.storage_key == ("questions/original/diagram.png")

    assert draft_image.storage_key != active_image.storage_key

    assert draft_image.storage_key.endswith(".webp")

    assert draft_image.alt_text == "Updated diagram"

    # Historical/live version still references
    # the original key, so it must survive.
    assert active_image.storage_key not in storage.delete_calls


def test_remove_image_deletes_unreferenced_object(
    client: TestClient,
    session: Session,
    storage: FakeR2Storage,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )

    certification, category = seed_scope(session)

    created = create_mc_draft(
        session,
        owner=contributor,
        certification=certification,
        category=category,
    )

    created_response = upload_image(
        client,
        question_id=(created.question_id),
        user=contributor,
    )

    assert created_response.status_code == 201

    image_id = created_response.json()["id"]

    record = session.exec(select(QuestionImage)).one()

    old_key = record.storage_key

    response = client.delete(
        (f"/admin/questions/{created.question_id}/images/{image_id}"),
        headers=auth_header(contributor),
    )

    assert response.status_code == 204

    assert session.exec(select(QuestionImage)).all() == []

    assert old_key in storage.delete_calls


def test_storage_failure_does_not_create_database_image(
    client: TestClient,
    session: Session,
):
    class FailingStorage(FakeR2Storage):
        def upload(
            self,
            *,
            key: str,
            content: bytes,
            media_type: str,
        ) -> None:
            raise R2StorageError("storage unavailable")

    failing_storage = FailingStorage()

    app.dependency_overrides[admin.get_r2_storage] = lambda: failing_storage

    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )

    certification, category = seed_scope(session)

    created = create_mc_draft(
        session,
        owner=contributor,
        certification=certification,
        category=category,
    )

    response = upload_image(
        client,
        question_id=(created.question_id),
        user=contributor,
    )

    assert response.status_code == 503

    assert session.exec(select(QuestionImage)).all() == []
