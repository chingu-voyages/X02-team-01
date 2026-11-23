"""JHEP-126 Checkpoint 3: admin permissions, readiness, and state updates."""

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
