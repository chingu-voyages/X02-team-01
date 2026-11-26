"""JHEP-107/126: admin permissions, readiness, and configuration updates."""

from collections.abc import Iterator
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.api.v1.endpoints import admin_practice_exams
from app.core.security import create_access_token
from app.db.session import get_session
from app.models import (
    AnswerOption,
    Category,
    Certification,
    PracticeExam,
    Question,
    QuestionVersion,
    User,
)

BASE = "/api/v1/admin/practice-exams"
app = FastAPI()
app.include_router(admin_practice_exams.router, prefix=BASE)


@pytest.fixture
def session() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _record):
        connection.execute("PRAGMA foreign_keys=ON")

    SQLModel.metadata.create_all(
        engine,
        tables=[
            User.__table__,
            Certification.__table__,
            Category.__table__,
            PracticeExam.__table__,
            Question.__table__,
            QuestionVersion.__table__,
            AnswerOption.__table__,
        ],
    )
    try:
        with Session(engine) as db:
            yield db
    finally:
        engine.dispose()


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


def _user(session: Session, role: str = "administrator") -> User:
    user = User(email=f"{uuid4()}@example.test", role=role)
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(str(user.id))}"}


def _scope(session: Session, threshold: int | None = 70):
    cert = Certification(
        name="Computer Science",
        code=f"CS-{uuid4().hex[:8]}",
        passing_threshold_pct=threshold,
        is_published=True,
    )
    session.add(cert)
    session.flush()
    category = Category(
        certification_id=cert.id,
        name="CS Fundamentals",
        is_published=True,
    )
    session.add(category)
    session.commit()
    return cert, category


def _eligible_question(session: Session, cert, category, author, *, active=True):
    question = Question(
        certification_id=cert.id,
        category_id=category.id,
        difficulty="easy",
        created_by_id=author.id,
    )
    session.add(question)
    session.flush()
    version = QuestionVersion(
        question_id=question.id,
        version_number=1,
        question_text=f"What is {uuid4().hex[:5]}?",
        question_type="multiple_choice",
        review_status="approved",
        publication_status="active" if active else "draft",
        submitted_by_id=author.id,
        reviewed_by_id=author.id,
        reviewed_at=datetime.now(UTC),
    )
    session.add(version)
    session.flush()
    session.add_all(
        [
            AnswerOption(
                question_version_id=version.id,
                position=1,
                option_text="Right",
                is_correct=True,
            ),
            AnswerOption(
                question_version_id=version.id,
                position=2,
                option_text="Wrong",
                is_correct=False,
            ),
        ]
    )
    session.commit()


def _payload(cert, category, *, count=None, name="Science Practice"):
    return {
        "certification_id": str(cert.id),
        "category_id": str(category.id),
        "name": name,
        "question_count": count,
    }


def _create_exam(client, headers, cert, category, *, count=None):
    return client.post(
        BASE, headers=headers, json=_payload(cert, category, count=count)
    )


def test_create_draft_and_inspect_missing_count(client, session):
    admin = _user(session)
    cert, category = _scope(session)
    created = _create_exam(client, _headers(admin), cert, category)
    assert created.status_code == 201
    exam = created.json()
    assert exam["status"] == "draft"
    assert exam["question_count"] is None
    assert exam["readiness"]["ready"] is False
    assert {issue["code"] for issue in exam["readiness"]["issues"]} == {
        "QUESTION_COUNT_MISSING"
    }

    detail = client.get(f"{BASE}/{exam['id']}", headers=_headers(admin))
    assert detail.status_code == 200
    assert detail.json()["id"] == exam["id"]

    listing = client.get(BASE, headers=_headers(admin))
    assert listing.status_code == 200
    assert listing.json()["count"] == 1
    assert listing.json()["items"][0]["id"] == exam["id"]


def test_publish_rejects_missing_count_and_preserves_draft(client, session):
    admin = _user(session)
    cert, category = _scope(session)
    created = _create_exam(client, _headers(admin), cert, category).json()

    response = client.patch(
        f"{BASE}/{created['id']}/publication",
        headers=_headers(admin),
        json={"is_published": True},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "PRACTICE_EXAM_NOT_READY"
    issues = response.json()["detail"]["readiness"]["issues"]
    assert any(issue["code"] == "QUESTION_COUNT_MISSING" for issue in issues)
    assert session.get(PracticeExam, UUID(created["id"])).status == "draft"


def test_publish_rejects_insufficient_question_pool(client, session):
    admin = _user(session)
    cert, category = _scope(session)
    _eligible_question(session, cert, category, admin)
    created = _create_exam(client, _headers(admin), cert, category, count=3).json()

    response = client.patch(
        f"{BASE}/{created['id']}/publication",
        headers=_headers(admin),
        json={"is_published": True},
    )
    assert response.status_code == 409
    readiness = response.json()["detail"]["readiness"]
    assert readiness["required_question_count"] == 3
    assert readiness["eligible_question_count"] == 1
    assert "INSUFFICIENT_PUBLISHED_QUESTIONS" in {
        issue["code"] for issue in readiness["issues"]
    }
    assert session.get(PracticeExam, UUID(created["id"])).status == "draft"


def test_publish_and_unpublish_are_idempotent(client, session):
    admin = _user(session)
    cert, category = _scope(session)
    _eligible_question(session, cert, category, admin)
    _eligible_question(session, cert, category, admin)
    created = _create_exam(client, _headers(admin), cert, category, count=2).json()
    url = f"{BASE}/{created['id']}/publication"

    for _ in range(2):
        response = client.patch(
            url, headers=_headers(admin), json={"is_published": True}
        )
        assert response.status_code == 200
        assert response.json()["status"] == "published"
        assert response.json()["readiness"]["ready"] is True

    for _ in range(2):
        response = client.patch(
            url, headers=_headers(admin), json={"is_published": False}
        )
        assert response.status_code == 200
        assert response.json()["status"] == "unpublished"

    assert session.get(PracticeExam, UUID(created["id"])).status == "unpublished"


def test_readiness_requires_parent_publication_and_threshold(client, session):
    admin = _user(session)
    cert, category = _scope(session, threshold=None)
    _eligible_question(session, cert, category, admin)
    category.is_published = False
    cert.is_published = False
    session.add_all([cert, category])
    session.commit()

    created = _create_exam(client, _headers(admin), cert, category, count=1)
    assert created.status_code == 201
    blockers = {i["code"] for i in created.json()["readiness"]["issues"]}
    assert {
        "CATEGORY_UNPUBLISHED",
        "CERTIFICATION_UNPUBLISHED",
        "PASSING_THRESHOLD_MISSING",
    }.issubset(blockers)


@pytest.mark.parametrize("invalid", [0, -1, 101, True, "4", 1.5])
def test_create_enforces_integer_question_count(client, session, invalid):
    admin = _user(session)
    cert, category = _scope(session)
    response = client.post(
        BASE,
        headers=_headers(admin),
        json=_payload(cert, category, count=invalid),
    )
    assert response.status_code == 422


def test_duplicate_name_and_cross_certification_scope_are_rejected(client, session):
    admin = _user(session)
    cert, category = _scope(session)
    first = _create_exam(client, _headers(admin), cert, category)
    second = _create_exam(client, _headers(admin), cert, category)
    assert first.status_code == 201
    assert second.status_code == 409

    unrelated_cert, _ = _scope(session)
    response = client.post(
        BASE,
        headers=_headers(admin),
        json=_payload(unrelated_cert, category),
    )
    assert response.status_code == 404


@pytest.mark.parametrize("role", ["learner", "contributor"])
def test_non_admin_cannot_access_or_mutate_exams(client, session, role):
    admin = _user(session)
    unauthorized = _user(session, role)
    cert, category = _scope(session)
    created = _create_exam(client, _headers(admin), cert, category, count=1).json()
    headers = _headers(unauthorized)

    assert client.get(BASE, headers=headers).status_code == 403
    assert client.get(f"{BASE}/{created['id']}", headers=headers).status_code == 403
    assert (
        client.post(BASE, headers=headers, json=_payload(cert, category)).status_code
        == 403
    )
    assert (
        client.patch(
            f"{BASE}/{created['id']}/publication",
            headers=headers,
            json={"is_published": True},
        ).status_code
        == 403
    )
    assert session.get(PracticeExam, UUID(created["id"])).status == "draft"


def test_unauthenticated_publication_is_rejected(client, session):
    cert, category = _scope(session)
    admin = _user(session)
    created = _create_exam(client, _headers(admin), cert, category).json()
    response = client.patch(
        f"{BASE}/{created['id']}/publication", json={"is_published": False}
    )
    assert response.status_code == 401
    assert session.get(PracticeExam, UUID(created["id"])).status == "draft"


def test_missing_exam_returns_404(client, session):
    admin = _user(session)
    response = client.patch(
        f"{BASE}/{uuid4()}/publication",
        headers=_headers(admin),
        json={"is_published": True},
    )
    assert response.status_code == 404


# JHEP-107 / JHEP-207: configuration editing


def _edit_url(exam):
    return f"{BASE}/{exam['id']}"


def _set_publication(client, headers, exam, *, published):
    return client.patch(
        f"{_edit_url(exam)}/publication",
        headers=headers,
        json={"is_published": published},
    )


def _saved_exam(session, exam):
    saved = session.get(PracticeExam, UUID(exam["id"]))
    assert saved is not None
    session.refresh(saved)
    return saved


def test_admin_can_configure_and_publish_existing_draft(client, session):
    admin = _user(session)
    headers = _headers(admin)
    cert, category = _scope(session)
    created = _create_exam(client, headers, cert, category).json()
    _eligible_question(session, cert, category, admin)

    response = client.put(
        _edit_url(created),
        headers=headers,
        json=_payload(cert, category, name=" Updated Science Exam ", count=1),
    )
    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["id"] == created["id"]
    assert updated["name"] == "Updated Science Exam"
    assert updated["question_count"] == 1
    assert updated["status"] == "draft"
    assert updated["readiness"]["ready"] is True
    assert updated["readiness"]["required_question_count"] == 1

    saved = _saved_exam(session, created)
    assert saved.name == "Updated Science Exam"
    assert saved.question_count == 1
    detail = client.get(_edit_url(created), headers=headers)
    assert detail.status_code == 200
    assert detail.json() == updated
    published = _set_publication(client, headers, created, published=True)
    assert published.status_code == 200
    assert published.json()["status"] == "published"


def test_draft_can_change_certification_and_category(client, session):
    headers = _headers(_user(session))
    cert, category = _scope(session)
    new_cert, new_category = _scope(session)
    created = _create_exam(client, headers, cert, category, count=1).json()

    response = client.put(
        _edit_url(created),
        headers=headers,
        json=_payload(new_cert, new_category, name="Moved Exam", count=2),
    )
    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["id"] == created["id"]
    assert updated["certification_id"] == str(new_cert.id)
    assert updated["category_id"] == str(new_category.id)
    assert updated["status"] == "draft"
    assert updated["readiness"]["ready"] is False
    assert updated["readiness"]["eligible_question_count"] == 0
    saved = _saved_exam(session, created)
    assert saved.certification_id == new_cert.id
    assert saved.category_id == new_category.id
    assert saved.question_count == 2


@pytest.mark.parametrize("count", [1, 100])
def test_configuration_accepts_count_boundaries(client, session, count):
    headers = _headers(_user(session))
    cert, category = _scope(session)
    created = _create_exam(client, headers, cert, category, count=5).json()
    response = client.put(
        _edit_url(created), headers=headers, json=_payload(cert, category, count=count)
    )
    assert response.status_code == 200, response.text
    assert response.json()["question_count"] == count
    assert response.json()["readiness"]["required_question_count"] == count
    assert response.json()["readiness"]["ready"] is False
    assert _saved_exam(session, created).question_count == count


@pytest.mark.parametrize("invalid", [None, 0, -1, 101, True, "4", 1.5])
def test_configuration_rejects_invalid_count(client, session, invalid):
    headers = _headers(_user(session))
    cert, category = _scope(session)
    created = _create_exam(client, headers, cert, category, count=5).json()
    response = client.put(
        _edit_url(created),
        headers=headers,
        json=_payload(cert, category, count=invalid),
    )
    assert response.status_code == 422
    assert _saved_exam(session, created).question_count == 5


@pytest.mark.parametrize("invalid_field", ["missing_count", "blank_name", "status"])
def test_configuration_rejects_incomplete_or_unexpected_fields(
    client, session, invalid_field
):
    headers = _headers(_user(session))
    cert, category = _scope(session)
    created = _create_exam(client, headers, cert, category, count=5).json()
    payload = _payload(cert, category, count=10)
    if invalid_field == "missing_count":
        del payload["question_count"]
    elif invalid_field == "blank_name":
        payload["name"] = "   "
    else:
        payload["status"] = "published"
    response = client.put(_edit_url(created), headers=headers, json=payload)
    assert response.status_code == 422
    saved = _saved_exam(session, created)
    assert saved.name == created["name"]
    assert saved.status == "draft"
    assert saved.question_count == 5


@pytest.mark.parametrize("role", ["learner", "contributor", None])
def test_configuration_requires_administrator(client, session, role):
    admin = _user(session)
    cert, category = _scope(session)
    created = _create_exam(client, _headers(admin), cert, category, count=5).json()
    headers = {} if role is None else _headers(_user(session, role))
    response = client.put(
        _edit_url(created),
        headers=headers,
        json=_payload(cert, category, name="Unauthorized change", count=10),
    )
    assert response.status_code == (401 if role is None else 403)
    saved = _saved_exam(session, created)
    assert saved.name == created["name"]
    assert saved.question_count == 5
    assert saved.status == "draft"


def test_published_exam_must_be_unpublished_before_editing(client, session):
    admin = _user(session)
    headers = _headers(admin)
    cert, category = _scope(session)
    _eligible_question(session, cert, category, admin)
    created = _create_exam(client, headers, cert, category, count=1).json()
    assert _set_publication(client, headers, created, published=True).status_code == 200

    response = client.put(
        _edit_url(created), headers=headers, json=_payload(cert, category, count=2)
    )
    assert response.status_code == 409
    saved = _saved_exam(session, created)
    assert saved.status == "published"
    assert saved.question_count == 1


def test_unpublished_exam_count_can_change_and_republish(client, session):
    admin = _user(session)
    headers = _headers(admin)
    cert, category = _scope(session)
    _eligible_question(session, cert, category, admin)
    _eligible_question(session, cert, category, admin)
    created = _create_exam(client, headers, cert, category, count=1).json()
    assert _set_publication(client, headers, created, published=True).status_code == 200
    assert (
        _set_publication(client, headers, created, published=False).status_code == 200
    )

    response = client.put(
        _edit_url(created), headers=headers, json=_payload(cert, category, count=2)
    )
    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["id"] == created["id"]
    assert updated["status"] == "unpublished"
    assert updated["name"] == created["name"]
    assert updated["question_count"] == 2
    assert updated["readiness"]["ready"] is True
    assert _saved_exam(session, created).question_count == 2
    published = _set_publication(client, headers, created, published=True)
    assert published.status_code == 200
    assert published.json()["question_count"] == 2
    assert published.json()["status"] == "published"


@pytest.mark.parametrize("field", ["name", "certification_id", "category_id"])
def test_unpublished_exam_identity_cannot_change(client, session, field):
    admin = _user(session)
    headers = _headers(admin)
    cert, category = _scope(session)
    other_cert, other_category = _scope(session)
    _eligible_question(session, cert, category, admin)
    created = _create_exam(client, headers, cert, category, count=1).json()
    assert _set_publication(client, headers, created, published=True).status_code == 200
    assert (
        _set_publication(client, headers, created, published=False).status_code == 200
    )
    payload = _payload(cert, category, count=2)
    payload[field] = {
        "name": "Renamed exam",
        "certification_id": str(other_cert.id),
        "category_id": str(other_category.id),
    }[field]
    response = client.put(_edit_url(created), headers=headers, json=payload)
    assert response.status_code == 409
    saved = _saved_exam(session, created)
    assert saved.name == created["name"]
    assert saved.certification_id == cert.id
    assert saved.category_id == category.id
    assert saved.question_count == 1
    assert saved.status == "unpublished"


def test_edit_recalculates_readiness_and_blocks_insufficient_pool(client, session):
    admin = _user(session)
    headers = _headers(admin)
    cert, category = _scope(session)
    _eligible_question(session, cert, category, admin)
    created = _create_exam(client, headers, cert, category, count=1).json()
    response = client.put(
        _edit_url(created), headers=headers, json=_payload(cert, category, count=2)
    )
    assert response.status_code == 200, response.text
    readiness = response.json()["readiness"]
    assert readiness["ready"] is False
    assert readiness["required_question_count"] == 2
    assert readiness["eligible_question_count"] == 1
    assert "INSUFFICIENT_PUBLISHED_QUESTIONS" in {
        issue["code"] for issue in readiness["issues"]
    }
    assert _set_publication(client, headers, created, published=True).status_code == 409
    assert _saved_exam(session, created).status == "draft"


def test_draft_edit_rejects_duplicate_name(client, session):
    headers = _headers(_user(session))
    cert, category = _scope(session)
    first = _create_exam(client, headers, cert, category).json()
    second_response = client.post(
        BASE,
        headers=headers,
        json=_payload(cert, category, name="Second Exam", count=5),
    )
    assert second_response.status_code == 201
    second = second_response.json()
    response = client.put(
        _edit_url(second),
        headers=headers,
        json=_payload(cert, category, name=first["name"], count=10),
    )
    assert response.status_code == 409
    saved = _saved_exam(session, second)
    assert saved.name == "Second Exam"
    assert saved.question_count == 5


def test_draft_edit_rejects_invalid_catalog_scope(client, session):
    headers = _headers(_user(session))
    cert, category = _scope(session)
    unrelated_cert, _ = _scope(session)
    created = _create_exam(client, headers, cert, category, count=5).json()
    response = client.put(
        _edit_url(created),
        headers=headers,
        json=_payload(unrelated_cert, category, count=10),
    )
    assert response.status_code == 404
    saved = _saved_exam(session, created)
    assert saved.certification_id == cert.id
    assert saved.category_id == category.id
    assert saved.question_count == 5


def test_configuration_update_of_missing_exam_returns_404(client, session):
    headers = _headers(_user(session))
    cert, category = _scope(session)
    response = client.put(
        f"{BASE}/{uuid4()}", headers=headers, json=_payload(cert, category, count=5)
    )
    assert response.status_code == 404
