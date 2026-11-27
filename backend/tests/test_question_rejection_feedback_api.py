from collections.abc import Iterator
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from admin_auth_fixtures import domain_access_token, make_domain_user
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.api.v1.endpoints import admin
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


def auth_header(
    user: User,
) -> dict[str, str]:
    return {
        "Authorization": ("Bearer " + domain_access_token(user)),
    }


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


def seed_catalog(
    session: Session,
) -> tuple[
    Certification,
    Category,
]:
    certification = Certification(
        name=("Rejection Feedback Certification"),
        code=(f"REJECT-{uuid4().hex[:8]}"),
    )

    session.add(certification)
    session.flush()

    category = Category(
        certification_id=(certification.id),
        name=("Review Feedback"),
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
            {
                "option_text": "Correct",
                "is_correct": True,
            },
            {
                "option_text": "Incorrect",
                "is_correct": False,
            },
        ],
        "expected_answer": None,
    }


def edit_payload(
    category_id: UUID,
) -> dict[str, object]:
    return {
        "category_id": str(category_id),
        "difficulty": "medium",
        "question_text": "Updated question after feedback",
        "question_type": "multiple_choice",
        "allows_multiple_answers": False,
        "explanation": "Updated explanation.",
        "options": [
            {
                "option_text": "Updated correct",
                "is_correct": True,
            },
            {
                "option_text": "Updated incorrect",
                "is_correct": False,
            },
        ],
        "expected_answer": None,
    }


def create_question(
    client: TestClient,
    contributor: User,
    certification: Certification,
    category: Category,
) -> UUID:
    response = client.post(
        "/admin/questions",
        headers=auth_header(contributor),
        json=create_payload(certification.id, category.id),
    )

    assert response.status_code == 201

    return UUID(response.json()["question_id"])


def submit_and_start_review(
    client: TestClient,
    *,
    question_id: UUID,
    contributor: User,
    administrator: User,
) -> None:
    """JHEP-119 requires submit -> start-review before an admin decision."""
    submitted = client.post(
        f"/admin/questions/{question_id}/submit",
        headers=auth_header(contributor),
    )
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["review_status"] == "submitted"

    in_review = client.post(
        f"/admin/questions/{question_id}/start-review",
        headers=auth_header(administrator),
    )
    assert in_review.status_code == 200, in_review.text
    assert in_review.json()["review_status"] == "in_review"


def test_requested_changes_feedback_is_visible_to_owner_and_clears_after_edit(
    client: TestClient,
    session: Session,
):
    """Request Changes is the editable feedback path, unlike terminal Reject."""
    contributor = create_user(session, UserRole.CONTRIBUTOR)
    administrator = create_user(session, UserRole.ADMINISTRATOR)
    certification, category = seed_catalog(session)
    question_id = create_question(client, contributor, certification, category)
    submit_and_start_review(
        client,
        question_id=question_id,
        contributor=contributor,
        administrator=administrator,
    )

    review_note = "Please clarify why option B is incorrect."
    requested_changes = client.post(
        f"/admin/questions/{question_id}/request-changes",
        headers=auth_header(administrator),
        json={"review_note": review_note},
    )

    assert requested_changes.status_code == 200, requested_changes.text
    assert requested_changes.json()["review_status"] == "pending"
    assert requested_changes.json()["publication_status"] == "draft"
    assert requested_changes.json()["review_note"] == review_note

    contributor_view = client.get(
        f"/admin/questions/{question_id}",
        headers=auth_header(contributor),
    )
    assert contributor_view.status_code == 200
    assert contributor_view.json()["review_note"] == review_note

    edited = client.patch(
        f"/admin/questions/{question_id}",
        headers=auth_header(contributor),
        json=edit_payload(category.id),
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["review_status"] == "pending"
    assert edited.json()["publication_status"] == "draft"
    assert edited.json()["review_note"] is None


def test_rejection_feedback_is_visible_but_rejected_question_cannot_be_edited(
    client: TestClient,
    session: Session,
):
    """Rejected questions retain reviewer feedback and cannot be reactivated by edit."""
    contributor = create_user(session, UserRole.CONTRIBUTOR)
    administrator = create_user(session, UserRole.ADMINISTRATOR)
    certification, category = seed_catalog(session)
    question_id = create_question(client, contributor, certification, category)
    submit_and_start_review(
        client,
        question_id=question_id,
        contributor=contributor,
        administrator=administrator,
    )

    review_note = "The answer is incorrect and cannot be approved."
    rejected = client.post(
        f"/admin/questions/{question_id}/reject",
        headers=auth_header(administrator),
        json={"review_note": review_note},
    )
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["review_status"] == "rejected"
    assert rejected.json()["publication_status"] == "inactive"
    assert rejected.json()["review_note"] == review_note

    contributor_view = client.get(
        f"/admin/questions/{question_id}",
        headers=auth_header(contributor),
    )
    assert contributor_view.status_code == 200
    assert contributor_view.json()["review_status"] == "rejected"
    assert contributor_view.json()["publication_status"] == "inactive"
    assert contributor_view.json()["review_note"] == review_note

    edited = client.patch(
        f"/admin/questions/{question_id}",
        headers=auth_header(contributor),
        json=edit_payload(category.id),
    )
    assert edited.status_code == 409

    still_rejected = client.get(
        f"/admin/questions/{question_id}",
        headers=auth_header(contributor),
    )
    assert still_rejected.status_code == 200
    assert still_rejected.json()["review_status"] == "rejected"
    assert still_rejected.json()["publication_status"] == "inactive"
    assert still_rejected.json()["review_note"] == review_note
