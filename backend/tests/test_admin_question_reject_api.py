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
from app.models.question_image import QuestionImage
from app.models.question_version import QuestionVersion
from app.models.text_answer_key import TextAnswerKey
from app.models.user import User
from app.schemas.admin_question import (
    QuestionDraftCreate,
    QuestionDraftEdit,
)
from app.services.admin_question_service import (
    create_question_draft,
    edit_question_draft,
)

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
    token = create_access_token(str(user.id))

    return {
        "Authorization": (f"Bearer {token}"),
    }


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


def create_payload(
    certification_id: UUID,
    category_id: UUID,
) -> QuestionDraftCreate:
    return QuestionDraftCreate.model_validate(
        {
            "certification_id": (certification_id),
            "category_id": (category_id),
            "difficulty": "medium",
            "question_text": ("Which statement is correct?"),
            "question_type": ("multiple_choice"),
            "allows_multiple_answers": (False),
            "explanation": ("The first answer is correct."),
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


def create_draft(
    session: Session,
    *,
    owner: User,
    certification: Certification,
    category: Category,
):
    return create_question_draft(
        session,
        create_payload(
            certification.id,
            category.id,
        ),
        actor_id=owner.id,
    )


def revision_payload(
    category: Category,
) -> QuestionDraftEdit:
    return QuestionDraftEdit.model_validate(
        {
            "category_id": (category.id),
            "difficulty": "medium",
            "question_text": ("Updated version of the question"),
            "question_type": ("multiple_choice"),
            "allows_multiple_answers": (False),
            "explanation": ("Updated explanation"),
            "options": [
                {
                    "option_text": ("Updated correct"),
                    "is_correct": True,
                },
                {
                    "option_text": ("Updated incorrect"),
                    "is_correct": False,
                },
            ],
        }
    )


def test_administrator_can_reject_pending_draft(
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

    created = create_draft(
        session,
        owner=contributor,
        certification=certification,
        category=category,
    )

    response = client.post(
        (f"/admin/questions/{created.question_id}/reject"),
        headers=auth_header(administrator),
        json={
            "review_note": ("Please clarify the explanation."),
        },
    )

    assert response.status_code == 200

    body = response.json()

    assert body["question_id"] == str(created.question_id)

    assert body["question_version_id"] == str(created.question_version_id)

    assert body["review_status"] == "rejected"

    assert body["publication_status"] == "draft"

    version = session.get(
        QuestionVersion,
        created.question_version_id,
    )

    assert version is not None

    assert version.review_status == "rejected"

    assert version.publication_status == "draft"

    assert version.reviewed_by_id == administrator.id

    assert version.reviewed_at is not None

    assert version.review_note == ("Please clarify the explanation.")


def test_rejection_note_is_trimmed(
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

    created = create_draft(
        session,
        owner=contributor,
        certification=certification,
        category=category,
    )

    response = client.post(
        (f"/admin/questions/{created.question_id}/reject"),
        headers=auth_header(administrator),
        json={
            "review_note": ("   Needs a clearer answer.   "),
        },
    )

    assert response.status_code == 200

    version = session.get(
        QuestionVersion,
        created.question_version_id,
    )

    assert version is not None

    assert version.review_note == "Needs a clearer answer."


@pytest.mark.parametrize(
    "role",
    [
        UserRole.CONTRIBUTOR,
        UserRole.LEARNER,
    ],
)
def test_non_administrator_cannot_reject(
    client: TestClient,
    session: Session,
    role: UserRole,
):
    actor = create_user(
        session,
        role,
    )

    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )

    certification, category = seed_scope(session)

    created = create_draft(
        session,
        owner=contributor,
        certification=certification,
        category=category,
    )

    response = client.post(
        (f"/admin/questions/{created.question_id}/reject"),
        headers=auth_header(actor),
        json={
            "review_note": ("This should not be accepted."),
        },
    )

    assert response.status_code == 403

    version = session.get(
        QuestionVersion,
        created.question_version_id,
    )

    assert version is not None

    assert version.review_status == "pending"

    assert version.publication_status == "draft"

    assert version.reviewed_by_id is None


def test_unauthenticated_rejection_is_rejected(
    client: TestClient,
    session: Session,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )

    certification, category = seed_scope(session)

    created = create_draft(
        session,
        owner=contributor,
        certification=certification,
        category=category,
    )

    response = client.post(
        (f"/admin/questions/{created.question_id}/reject"),
        json={
            "review_note": ("Reject this question."),
        },
    )

    assert response.status_code == 401


def test_blank_review_note_is_rejected(
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

    created = create_draft(
        session,
        owner=contributor,
        certification=certification,
        category=category,
    )

    response = client.post(
        (f"/admin/questions/{created.question_id}/reject"),
        headers=auth_header(administrator),
        json={
            "review_note": "    ",
        },
    )

    assert response.status_code == 422

    version = session.get(
        QuestionVersion,
        created.question_version_id,
    )

    assert version is not None

    assert version.review_status == "pending"

    assert version.reviewed_by_id is None


def test_missing_question_returns_404(
    client: TestClient,
    session: Session,
):
    administrator = create_user(
        session,
        UserRole.ADMINISTRATOR,
    )

    response = client.post(
        (f"/admin/questions/{uuid4()}/reject"),
        headers=auth_header(administrator),
        json={
            "review_note": ("Question is invalid."),
        },
    )

    assert response.status_code == 404

    assert response.json() == {
        "detail": "Question not found",
    }


def test_rejected_question_cannot_be_rejected_again(
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

    created = create_draft(
        session,
        owner=contributor,
        certification=certification,
        category=category,
    )

    url = f"/admin/questions/{created.question_id}/reject"

    headers = auth_header(administrator)

    payload = {
        "review_note": ("Needs correction."),
    }

    first = client.post(
        url,
        headers=headers,
        json=payload,
    )

    second = client.post(
        url,
        headers=headers,
        json=payload,
    )

    assert first.status_code == 200

    assert second.status_code == 409

    assert second.json() == {
        "detail": ("Only pending draft questions can be rejected"),
    }


def test_active_question_cannot_be_rejected(
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

    created = create_draft(
        session,
        owner=contributor,
        certification=certification,
        category=category,
    )

    publish_response = client.post(
        (f"/admin/questions/{created.question_id}/publish"),
        headers=auth_header(administrator),
    )

    assert publish_response.status_code == 200

    reject_response = client.post(
        (f"/admin/questions/{created.question_id}/reject"),
        headers=auth_header(administrator),
        json={
            "review_note": ("Reject active question."),
        },
    )

    assert reject_response.status_code == 409

    version = session.get(
        QuestionVersion,
        created.question_version_id,
    )

    assert version is not None

    assert version.review_status == "approved"

    assert version.publication_status == "active"


def test_rejecting_revision_preserves_old_active_version(
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

    created = create_draft(
        session,
        owner=contributor,
        certification=certification,
        category=category,
    )

    publish_response = client.post(
        (f"/admin/questions/{created.question_id}/publish"),
        headers=auth_header(administrator),
    )

    assert publish_response.status_code == 200

    revised = edit_question_draft(
        session,
        created.question_id,
        revision_payload(category),
        actor=administrator,
    )

    assert revised.version_number == 2

    assert revised.review_status == "pending"

    assert revised.publication_status == "draft"

    reject_response = client.post(
        (f"/admin/questions/{created.question_id}/reject"),
        headers=auth_header(administrator),
        json={
            "review_note": ("Revision needs additional work."),
        },
    )

    assert reject_response.status_code == 200

    versions = session.exec(
        select(QuestionVersion)
        .where(QuestionVersion.question_id == created.question_id)
        .order_by(QuestionVersion.version_number)
    ).all()

    assert len(versions) == 2

    original = versions[0]
    revision = versions[1]

    assert original.version_number == 1

    assert original.review_status == "approved"

    assert original.publication_status == "active"

    assert revision.version_number == 2

    assert revision.review_status == "rejected"

    assert revision.publication_status == "draft"

    assert revision.review_note == ("Revision needs additional work.")

    active_versions = [
        version for version in versions if (version.publication_status == "active")
    ]

    assert len(active_versions) == 1

    assert active_versions[0].id == original.id


def test_editing_rejected_draft_resets_review_state(
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

    created = create_draft(
        session,
        owner=contributor,
        certification=certification,
        category=category,
    )

    reject_response = client.post(
        (f"/admin/questions/{created.question_id}/reject"),
        headers=auth_header(administrator),
        json={
            "review_note": ("Please revise this."),
        },
    )

    assert reject_response.status_code == 200

    edited = edit_question_draft(
        session,
        created.question_id,
        revision_payload(category),
        actor=contributor,
    )

    assert edited.review_status == "pending"

    assert edited.publication_status == "draft"

    version = session.get(
        QuestionVersion,
        created.question_version_id,
    )

    assert version is not None

    assert version.review_status == "pending"

    assert version.reviewed_by_id is None

    assert version.reviewed_at is None

    assert version.review_note is None
