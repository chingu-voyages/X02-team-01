from collections.abc import Iterator
from uuid import uuid4

import pytest
import sqlalchemy as sa
from admin_auth_fixtures import domain_access_token, make_domain_user
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import (
    Session,
    SQLModel,
    create_engine,
)

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
from app.services.admin_question_service import create_question_draft

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
    token = domain_access_token(user)

    return {"Authorization": (f"Bearer {token}")}


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


def mc_payload(
    certification: Certification,
    category: Category,
    *,
    question_text: str,
) -> QuestionDraftCreate:
    return QuestionDraftCreate.model_validate(
        {
            "certification_id": (certification.id),
            "category_id": (category.id),
            "difficulty": ("medium"),
            "question_text": (question_text),
            "question_type": ("multiple_choice"),
            "allows_multiple_answers": (False),
            "explanation": ("Management explanation"),
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
            question_text=(question_text),
        ),
        actor_id=owner.id,
    )


def test_empty_question_bank_returns_explicit_empty_state(
    client: TestClient,
    session: Session,
):
    administrator = create_user(
        session,
        UserRole.ADMINISTRATOR,
    )

    response = client.get(
        "/admin/questions",
        headers=auth_header(administrator),
    )

    assert response.status_code == 200

    assert response.json() == {
        "items": [],
        "count": 0,
    }


def test_learner_cannot_access_question_bank(
    client: TestClient,
    session: Session,
):
    learner = create_user(
        session,
        UserRole.LEARNER,
    )

    response = client.get(
        "/admin/questions",
        headers=auth_header(learner),
    )

    assert response.status_code == 403

    assert response.json() == {"detail": ("Insufficient permissions")}


def test_contributor_list_contains_only_owned_questions(
    client: TestClient,
    session: Session,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )

    other_contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )

    certification, category = seed_scope(session)

    own = seed_question(
        session,
        owner=contributor,
        certification=certification,
        category=category,
        question_text=("Contributor-owned question"),
    )

    seed_question(
        session,
        owner=other_contributor,
        certification=certification,
        category=category,
        question_text=("Another contributor's question"),
    )

    response = client.get(
        "/admin/questions",
        headers=auth_header(contributor),
    )

    assert response.status_code == 200

    body = response.json()

    assert body["count"] == 1
    assert body["items"][0]["question_id"] == str(own.question_id)
    assert body["items"][0]["question_preview"] == ("Contributor-owned question")
    assert body["items"][0]["certification_name"] == ("Example Certification")
    assert body["items"][0]["category_name"] == "Example Category"
    assert body["items"][0]["review_status"] == "pending"
    assert body["items"][0]["publication_status"] == "draft"
    assert body["items"][0]["last_updated"] is not None


def test_administrator_list_contains_all_questions(
    client: TestClient,
    session: Session,
):
    administrator = create_user(
        session,
        UserRole.ADMINISTRATOR,
    )

    first_contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )

    second_contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )

    certification, category = seed_scope(session)

    seed_question(
        session,
        owner=first_contributor,
        certification=certification,
        category=category,
        question_text=("First question"),
    )

    seed_question(
        session,
        owner=second_contributor,
        certification=certification,
        category=category,
        question_text=("Second question"),
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
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )

    certification, category = seed_scope(session)

    created = seed_question(
        session,
        owner=contributor,
        certification=certification,
        category=category,
        question_text=("Detail question"),
    )

    response = client.get(
        (f"/admin/questions/{created.question_id}"),
        headers=auth_header(contributor),
    )

    assert response.status_code == 200

    body = response.json()

    assert body["question_text"] == "Detail question"
    assert body["question_type"] == "multiple_choice"
    assert body["explanation"] == ("Management explanation")
    assert body["version_number"] == 1
    assert body["created_by_id"] == str(contributor.id)

    assert body["options"] == [
        {
            "position": 1,
            "option_text": ("Correct"),
            "is_correct": True,
        },
        {
            "position": 2,
            "option_text": ("Incorrect"),
            "is_correct": False,
        },
    ]

    assert body["expected_answer"] is None
    assert body["images"] == []


def test_contributor_cannot_probe_another_contributors_question(
    client: TestClient,
    session: Session,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )

    other_contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )

    certification, category = seed_scope(session)

    foreign = seed_question(
        session,
        owner=other_contributor,
        certification=certification,
        category=category,
        question_text=("Foreign question"),
    )

    response = client.get(
        (f"/admin/questions/{foreign.question_id}"),
        headers=auth_header(contributor),
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "Question not found"}


def test_administrator_can_view_contributor_question_detail(
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

    created = seed_question(
        session,
        owner=contributor,
        certification=certification,
        category=category,
        question_text=("Administrator-visible question"),
    )

    response = client.get(
        (f"/admin/questions/{created.question_id}"),
        headers=auth_header(administrator),
    )

    assert response.status_code == 200
    assert response.json()["question_text"] == ("Administrator-visible question")


def test_question_bank_uses_latest_version_for_list_and_detail(
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

    created = seed_question(
        session,
        owner=contributor,
        certification=certification,
        category=category,
        question_text=("Original version"),
    )

    second_version = QuestionVersion(
        question_id=(created.question_id),
        version_number=2,
        question_text=("Latest draft version"),
        question_type=("multiple_choice"),
        allows_multiple_answers=False,
        explanation=("Updated explanation"),
        review_status="pending",
        publication_status="draft",
        is_flagged=False,
        submitted_by_id=(administrator.id),
    )

    session.add(second_version)
    session.flush()

    session.add_all(
        [
            AnswerOption(
                question_version_id=(second_version.id),
                option_text=("New correct"),
                is_correct=True,
                position=1,
            ),
            AnswerOption(
                question_version_id=(second_version.id),
                option_text=("New incorrect"),
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
        (f"/admin/questions/{created.question_id}"),
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
    assert detail["question_text"] == ("Latest draft version")
    assert detail["options"][0]["option_text"] == "New correct"


def test_question_detail_returns_safe_hosted_image_metadata(
    client: TestClient,
    session: Session,
    monkeypatch,
):
    monkeypatch.setattr(
        settings,
        "media_base_url",
        "https://cdn.example.test",
    )

    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )

    certification, category = seed_scope(session)

    created = seed_question(
        session,
        owner=contributor,
        certification=certification,
        category=category,
        question_text=("Question with diagram"),
    )

    image = QuestionImage(
        question_version_id=(created.question_version_id),
        storage_key=("questions/demo/diagram ü.png"),
        alt_text=("Diagram showing an iterative workflow"),
        media_type="image/png",
        position=1,
    )

    session.add(image)
    session.commit()
    session.refresh(image)

    response = client.get(
        (f"/admin/questions/{created.question_id}"),
        headers=auth_header(contributor),
    )

    assert response.status_code == 200

    body = response.json()

    assert body["images"] == [
        {
            "id": str(image.id),
            "question_version_id": str(created.question_version_id),
            "position": 1,
            "alt_text": ("Diagram showing an iterative workflow"),
            "media_type": ("image/png"),
            "url": ("https://cdn.example.test/questions/demo/diagram%20%C3%BC.png"),
        }
    ]

    assert "storage_key" not in body["images"][0]


def test_question_bank_paginates_on_server(
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

    for index in range(5):
        seed_question(
            session,
            owner=contributor,
            certification=certification,
            category=category,
            question_text=(f"Paginated question {index}"),
        )

    first = client.get(
        "/admin/questions?page=1&page_size=2",
        headers=auth_header(administrator),
    )
    second = client.get(
        "/admin/questions?page=2&page_size=2",
        headers=auth_header(administrator),
    )
    third = client.get(
        "/admin/questions?page=3&page_size=2",
        headers=auth_header(administrator),
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert third.status_code == 200

    first_body = first.json()
    second_body = second.json()
    third_body = third.json()

    assert first_body["count"] == 5
    assert second_body["count"] == 5
    assert third_body["count"] == 5

    assert len(first_body["items"]) == 2
    assert len(second_body["items"]) == 2
    assert len(third_body["items"]) == 1

    all_ids = {
        item["question_id"]
        for body in (
            first_body,
            second_body,
            third_body,
        )
        for item in body["items"]
    }

    assert len(all_ids) == 5


def test_question_bank_search_is_case_insensitive(
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

    seed_question(
        session,
        owner=contributor,
        certification=certification,
        category=category,
        question_text="What is AWS IAM?",
    )
    seed_question(
        session,
        owner=contributor,
        certification=certification,
        category=category,
        question_text="What is Scrum?",
    )

    response = client.get(
        "/admin/questions?search=iam",
        headers=auth_header(administrator),
    )

    assert response.status_code == 200

    body = response.json()

    assert body["count"] == 1
    assert len(body["items"]) == 1
    assert body["items"][0]["question_preview"] == "What is AWS IAM?"


def test_question_bank_filters_by_certification_and_category(
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

    first_certification, first_category = seed_scope(session)

    second_certification = Certification(
        name="Second Certification",
        code=f"SECOND-{uuid4().hex[:8]}",
    )
    session.add(second_certification)
    session.flush()

    second_category = Category(
        certification_id=second_certification.id,
        name="Second Category",
    )
    session.add(second_category)
    session.commit()

    first_question = seed_question(
        session,
        owner=contributor,
        certification=first_certification,
        category=first_category,
        question_text="First scope question",
    )
    second_question = seed_question(
        session,
        owner=contributor,
        certification=second_certification,
        category=second_category,
        question_text="Second scope question",
    )

    certification_response = client.get(
        (f"/admin/questions?certification_id={first_certification.id}"),
        headers=auth_header(administrator),
    )

    assert certification_response.status_code == 200
    certification_body = certification_response.json()
    assert certification_body["count"] == 1
    assert certification_body["items"][0]["question_id"] == str(
        first_question.question_id
    )

    category_response = client.get(
        (f"/admin/questions?category_id={second_category.id}"),
        headers=auth_header(administrator),
    )

    assert category_response.status_code == 200
    category_body = category_response.json()
    assert category_body["count"] == 1
    assert category_body["items"][0]["question_id"] == str(second_question.question_id)


def test_question_bank_filters_by_question_metadata(
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

    created = seed_question(
        session,
        owner=contributor,
        certification=certification,
        category=category,
        question_text="Metadata-filter question",
    )

    response = client.get(
        (
            "/admin/questions"
            "?difficulty=medium"
            "&question_type=multiple_choice"
            "&review_status=pending"
            "&publication_status=draft"
        ),
        headers=auth_header(administrator),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    assert body["items"][0]["question_id"] == str(created.question_id)


def test_question_bank_filters_by_image_presence(
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

    with_image = seed_question(
        session,
        owner=contributor,
        certification=certification,
        category=category,
        question_text="Question with image",
    )
    without_image = seed_question(
        session,
        owner=contributor,
        certification=certification,
        category=category,
        question_text="Question without image",
    )

    session.add(
        QuestionImage(
            question_version_id=with_image.question_version_id,
            storage_key="questions/test/image.png",
            alt_text="Test diagram",
            media_type="image/png",
            position=1,
        )
    )
    session.commit()

    with_response = client.get(
        "/admin/questions?has_image=true",
        headers=auth_header(administrator),
    )
    without_response = client.get(
        "/admin/questions?has_image=false",
        headers=auth_header(administrator),
    )

    assert with_response.status_code == 200
    assert without_response.status_code == 200

    with_body = with_response.json()
    without_body = without_response.json()

    assert with_body["count"] == 1
    assert with_body["items"][0]["question_id"] == str(with_image.question_id)
    assert with_body["items"][0]["has_image"] is True

    assert without_body["count"] == 1
    assert without_body["items"][0]["question_id"] == str(without_image.question_id)
    assert without_body["items"][0]["has_image"] is False


@pytest.mark.parametrize(
    "query",
    [
        "page=0",
        "page_size=101",
    ],
)
def test_question_bank_rejects_invalid_pagination(
    client: TestClient,
    session: Session,
    query: str,
):
    administrator = create_user(
        session,
        UserRole.ADMINISTRATOR,
    )

    response = client.get(
        f"/admin/questions?{query}",
        headers=auth_header(administrator),
    )

    assert response.status_code == 422


def test_contributor_search_cannot_leak_foreign_questions(
    client: TestClient,
    session: Session,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )
    other_contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )
    certification, category = seed_scope(session)

    seed_question(
        session,
        owner=other_contributor,
        certification=certification,
        category=category,
        question_text="Private foreign IAM question",
    )

    response = client.get(
        ("/admin/questions?search=Private%20foreign%20IAM"),
        headers=auth_header(contributor),
    )

    assert response.status_code == 200
    assert response.json() == {
        "items": [],
        "count": 0,
    }


def test_review_queue_filters_by_review_status_and_author(
    client: TestClient,
    session: Session,
):
    """JHEP-119 AC2: the review queue — server-side review-status and
    author filtering on top of the role scoping."""
    from app.services.admin_question_service import (
        submit_question_for_review,
    )
    from tests.test_admin_question_reject_api import create_draft, seed_scope

    administrator = create_user(session, UserRole.ADMINISTRATOR)
    contributor = create_user(session, UserRole.CONTRIBUTOR)
    certification, category = seed_scope(session)

    create_draft(
        session,
        owner=contributor,
        certification=certification,
        category=category,
    )
    submitted = create_draft(
        session,
        owner=contributor,
        certification=certification,
        category=category,
    )
    submit_question_for_review(
        session,
        submitted.question_id,
        actor=contributor,
    )

    admin_headers = auth_header(administrator)

    # the unfiltered list still returns everything
    all_items = client.get("/admin/questions", headers=admin_headers).json()["items"]
    assert len(all_items) == 2

    # the queue filter: only the submitted question
    queue = client.get(
        "/admin/questions",
        params={"review_status": "submitted"},
        headers=admin_headers,
    ).json()["items"]
    assert len(queue) == 1
    assert queue[0]["question_id"] == str(submitted.question_id)

    # the author filter
    by_author = client.get(
        "/admin/questions",
        params={"author_email": contributor.email},
        headers=admin_headers,
    ).json()["items"]
    assert len(by_author) == 2

    # a learner's scoping is unaffected
    learner = create_user(session, UserRole.LEARNER)
    learner_response = client.get("/admin/questions", headers=auth_header(learner))
    assert learner_response.status_code == 403  # the router guard
