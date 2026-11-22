"""JHEP-126 Checkpoint 4: the real HTTP start route honors exam publication."""

from collections.abc import Iterator
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.api.v1.endpoints import (
    admin_practice_exams,
    exams,
    learner_practice_exams,
)
from app.core.security import create_access_token
from app.db.session import get_session
from app.models import (
    AnswerOption,
    Category,
    Certification,
    ExamAttempt,
    ExamAttemptQuestion,
    ExamResult,
    PracticeExam,
    Question,
    QuestionImage,
    QuestionVersion,
    User,
)

API = "/api/v1"


@pytest.fixture
def environment() -> Iterator[tuple[TestClient, Session]]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def foreign_keys(dbapi_connection, _record):
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

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
            QuestionImage.__table__,
            ExamAttempt.__table__,
            ExamAttemptQuestion.__table__,
            ExamResult.__table__,
        ],
    )
    test_app = FastAPI()
    test_app.include_router(learner_practice_exams.router, prefix=f"{API}/exams")
    test_app.include_router(exams.router, prefix=f"{API}/exams")
    test_app.include_router(
        admin_practice_exams.router, prefix=f"{API}/admin/practice-exams"
    )
    try:
        with Session(engine) as session:

            def override_session() -> Iterator[Session]:
                yield session

            test_app.dependency_overrides[get_session] = override_session
            with TestClient(test_app) as client:
                yield client, session
    finally:
        engine.dispose()


def _user(session: Session, role: str = "learner") -> User:
    user = User(email=f"{uuid4()}@example.test", role=role, is_verified=True)
    session.add(user)
    session.commit()
    return user


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(str(user.id))}"}


def _seed_bank(session: Session, author: User, *, count: int = 2):
    cert = Certification(
        name="Computer Science",
        code=f"CS-{uuid4().hex[:8]}",
        is_published=True,
        passing_threshold_pct=70,
    )
    session.add(cert)
    session.flush()
    category = Category(
        certification_id=cert.id, name="Fundamentals", is_published=True
    )
    session.add(category)
    session.flush()
    for index in range(count):
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
            question_text=f"Practice question {index + 1}?",
            question_type="multiple_choice",
            review_status="approved",
            publication_status="active",
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
                    option_text="Correct",
                    is_correct=True,
                ),
                AnswerOption(
                    question_version_id=version.id,
                    position=2,
                    option_text="Incorrect",
                    is_correct=False,
                ),
            ]
        )
    session.commit()
    return cert, category


def _create_exam(client, admin, cert, category, count=2, name="Science Practice"):
    response = client.post(
        f"{API}/admin/practice-exams",
        headers=_headers(admin),
        json={
            "certification_id": str(cert.id),
            "category_id": str(category.id),
            "name": name,
            "question_count": count,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _publish(client, admin, exam_id, state=True):
    return client.patch(
        f"{API}/admin/practice-exams/{exam_id}/publication",
        headers=_headers(admin),
        json={"is_published": state},
    )


def _start(client, learner, cert, category, *, count, exam_id=None):
    body = {
        "certification_id": str(cert.id),
        "category_id": str(category.id),
        "question_count": count,
    }
    if exam_id is not None:
        body["practice_exam_id"] = exam_id
    return client.post(f"{API}/exams", headers=_headers(learner), json=body)


def test_only_published_ready_exams_appear_and_start(environment):
    client, session = environment
    admin, learner = _user(session, "administrator"), _user(session)
    cert, category = _seed_bank(session, admin)
    exam = _create_exam(client, admin, cert, category)

    assert client.get(f"{API}/exams/catalog").status_code == 401
    assert client.get(f"{API}/exams/catalog", headers=_headers(learner)).json() == {
        "exams": []
    }
    assert (
        _start(client, learner, cert, category, count=2, exam_id=exam["id"]).json()[
            "detail"
        ]["code"]
        == "PRACTICE_EXAM_UNAVAILABLE"
    )

    assert _publish(client, admin, exam["id"]).status_code == 200
    listing = client.get(f"{API}/exams/catalog", headers=_headers(learner))
    assert listing.status_code == 200
    assert len(listing.json()["exams"]) == 1
    entry = listing.json()["exams"][0]
    assert entry["id"] == exam["id"]
    assert entry["name"] == "Science Practice"
    assert entry["question_count"] == 2
    assert entry["available_question_count"] == 2
    assert "is_correct" not in listing.text
    assert "status" not in entry

    started = _start(client, learner, cert, category, count=2, exam_id=exam["id"])
    assert started.status_code == 201, started.text
    assert started.json()["question_count"] == 2
    assert len(started.json()["questions"]) == 2
    assert "is_correct" not in started.text


def test_draft_unpublished_and_legacy_direct_starts_are_blocked(environment):
    client, session = environment
    admin, learner = _user(session, "administrator"), _user(session)
    cert, category = _seed_bank(session, admin)
    exam = _create_exam(client, admin, cert, category)

    for exam_id in (exam["id"], None):
        response = _start(client, learner, cert, category, count=2, exam_id=exam_id)
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "PRACTICE_EXAM_UNAVAILABLE"

    _publish(client, admin, exam["id"])
    _publish(client, admin, exam["id"], state=False)
    assert client.get(f"{API}/exams/catalog", headers=_headers(learner)).json() == {
        "exams": []
    }
    response = _start(client, learner, cert, category, count=2, exam_id=exam["id"])
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "PRACTICE_EXAM_UNAVAILABLE"
    assert session.exec(select(ExamAttempt)).all() == []


def test_client_cannot_override_configured_length(environment):
    client, session = environment
    admin, learner = _user(session, "administrator"), _user(session)
    cert, category = _seed_bank(session, admin)
    exam = _create_exam(client, admin, cert, category)
    assert _publish(client, admin, exam["id"]).status_code == 200

    override = _start(client, learner, cert, category, count=1, exam_id=exam["id"])
    assert override.status_code == 409
    assert override.json()["detail"] == {
        "code": "PRACTICE_EXAM_COUNT_MISMATCH",
        "message": "This practice exam requires exactly 2 questions",
        "expected": 2,
        "received": 1,
    }
    assert session.exec(select(ExamAttempt)).all() == []


def test_scope_and_uncategorized_bypass_are_rejected(environment):
    client, session = environment
    admin, learner = _user(session, "administrator"), _user(session)
    cert, category = _seed_bank(session, admin)
    exam = _create_exam(client, admin, cert, category)
    assert _publish(client, admin, exam["id"]).status_code == 200

    other_category = Category(
        certification_id=cert.id,
        name="Other category",
        is_published=True,
    )
    session.add(other_category)
    session.commit()
    assert (
        _start(
            client, learner, cert, other_category, count=2, exam_id=exam["id"]
        ).status_code
        == 409
    )

    uncategorized = client.post(
        f"{API}/exams",
        headers=_headers(learner),
        json={"certification_id": str(cert.id), "question_count": 2},
    )
    assert uncategorized.status_code == 409
    assert uncategorized.json()["detail"]["code"] == "PRACTICE_EXAM_UNAVAILABLE"


def test_unpublish_preserves_existing_attempt_and_completed_history(environment):
    client, session = environment
    admin, learner = _user(session, "administrator"), _user(session)
    second_learner = _user(session)
    cert, category = _seed_bank(session, admin)
    exam = _create_exam(client, admin, cert, category)
    assert _publish(client, admin, exam["id"]).status_code == 200

    started = _start(client, learner, cert, category, count=2, exam_id=exam["id"])
    assert started.status_code == 201
    attempt_id = UUID(started.json()["attempt_id"])
    pinned = session.exec(
        select(ExamAttemptQuestion).where(ExamAttemptQuestion.attempt_id == attempt_id)
    ).all()
    assert len(pinned) == 2

    unpublish = _publish(client, admin, exam["id"], state=False)
    assert unpublish.status_code == 200
    assert unpublish.json()["status"] == "unpublished"
    blocked = _start(
        client, second_learner, cert, category, count=2, exam_id=exam["id"]
    )
    assert blocked.status_code == 409
    assert session.get(ExamAttempt, attempt_id).status == "in_progress"
    assert (
        len(
            session.exec(
                select(ExamAttemptQuestion).where(
                    ExamAttemptQuestion.attempt_id == attempt_id
                )
            ).all()
        )
        == 2
    )

    # JHEP-35 already has a separate grading lifecycle. Here we verify
    # unpublishing does not delete or change a previously persisted result.
    prior = session.get(ExamAttempt, attempt_id)
    prior.status = "submitted"
    prior.submitted_at = datetime.now(UTC)
    session.add(prior)
    session.add(
        ExamResult(
            attempt_id=attempt_id,
            points_earned=2,
            points_possible=2,
            score_pct=100,
            threshold_pct=70,
            passed=True,
        )
    )
    session.commit()
    assert _publish(client, admin, exam["id"], state=False).status_code == 200
    assert session.get(ExamAttempt, attempt_id).status == "submitted"
    assert session.exec(select(ExamResult)).one().attempt_id == attempt_id


def test_unpublished_parents_or_insufficient_pool_hide_catalog(environment):
    client, session = environment
    admin, learner = _user(session, "administrator"), _user(session)
    cert, category = _seed_bank(session, admin)
    exam = _create_exam(client, admin, cert, category)
    assert _publish(client, admin, exam["id"]).status_code == 200

    category.is_published = False
    session.add(category)
    session.commit()
    assert client.get(f"{API}/exams/catalog", headers=_headers(learner)).json() == {
        "exams": []
    }
    blocked = _start(client, learner, cert, category, count=2, exam_id=exam["id"])
    assert blocked.status_code == 409

    category.is_published = True
    session.add(category)
    versions = session.exec(select(QuestionVersion)).all()
    versions[0].is_flagged = True
    session.add(versions[0])
    session.commit()
    assert client.get(f"{API}/exams/catalog", headers=_headers(learner)).json() == {
        "exams": []
    }
    started = _start(client, learner, cert, category, count=2, exam_id=exam["id"])
    assert started.status_code == 409
    assert started.json()["detail"]["code"] == "INSUFFICIENT_QUESTIONS"


def test_two_differently_named_exams_can_share_a_category(environment):
    client, session = environment
    admin, learner = _user(session, "administrator"), _user(session)
    cert, category = _seed_bank(session, admin, count=3)
    first = _create_exam(client, admin, cert, category, count=1, name="Quick Practice")
    second = _create_exam(client, admin, cert, category, count=3, name="Full Practice")
    assert _publish(client, admin, first["id"]).status_code == 200
    assert _publish(client, admin, second["id"]).status_code == 200
    catalog = client.get(f"{API}/exams/catalog", headers=_headers(learner))
    assert {row["name"] for row in catalog.json()["exams"]} == {
        "Quick Practice",
        "Full Practice",
    }

    # Learners start the exact selected exam, using its configured length.
    started = _start(client, learner, cert, category, count=1, exam_id=first["id"])
    assert started.status_code == 201
    assert started.json()["question_count"] == 1
