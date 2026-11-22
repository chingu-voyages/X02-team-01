"""JHEP-126 final PostgreSQL proof: real HTTP lifecycle and publication locks.

Opt in on LOCAL PostgreSQL only:
    RUN_DB_INTEGRATION=1 python -m pytest -q tests/test_jhep126_final_integration.py

Each test creates and drops its own named schema. Tests never touch real data.
"""

import os
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import UTC, datetime
from threading import Event
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlmodel import Session, SQLModel, select

from app import models  # noqa: F401  -- register all tables
from app.core.security import create_access_token
from app.db.session import engine, get_session
from app.main import app
from app.models import (
    AnswerOption,
    Category,
    Certification,
    ExamAttempt,
    ExamResult,
    PracticeExam,
    Question,
    QuestionVersion,
    User,
)
from app.repositories.sqlmodel_repository import SQLModelQuestionRepository
from app.services.admin_practice_exam_service import set_practice_exam_publication
from app.services.published_exam_service import PublishedExamService

API = "/api/v1"


@pytest.fixture
def pg_environment():
    """Real PostgreSQL, committed transactions, isolated disposable schema.

    Separate connections are necessary to test row-lock behavior; the usual
    savepoint-based test fixtures cannot establish inter-connection locks.
    """
    if os.getenv("RUN_DB_INTEGRATION") != "1":
        pytest.skip("Set RUN_DB_INTEGRATION=1 to test local PostgreSQL")
    if engine.url.get_backend_name() != "postgresql":
        pytest.fail("These integration tests require PostgreSQL")
    if engine.url.host not in ("127.0.0.1", "localhost", None):
        pytest.fail("Refusing to run JHEP-126 integration tests on a remote host")
    if not engine.url.database or "prod" in engine.url.database.lower():
        pytest.fail("Refusing to run against a production-looking database")

    schema = f"jhep126_final_{uuid4().hex[:12]}"

    @contextmanager
    def session_factory() -> Iterator[Session]:
        with engine.connect() as connection:
            scoped = connection.execution_options(
                schema_translate_map={None: schema}
            )
            with Session(bind=scoped) as session:
                yield session

    def override_session() -> Iterator[Session]:
        with session_factory() as session:
            yield session

    try:
        with engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
            scoped = connection.execution_options(
                schema_translate_map={None: schema}
            )
            SQLModel.metadata.create_all(scoped)

        app.dependency_overrides[get_session] = override_session
        with TestClient(app) as client:
            yield client, session_factory
    finally:
        app.dependency_overrides.pop(get_session, None)
        # The generated identifier is controlled by this test, never input.
        with engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))


def _seed_bank(session: Session, question_count: int = 2) -> dict:
    """Publish only question-bank content, NOT a practice exam."""
    admin = User(
        email=f"admin-{uuid4().hex}@example.test",
        role="administrator",
        is_verified=True,
    )
    learner = User(
        email=f"learner-{uuid4().hex}@example.test",
        role="learner",
        is_verified=True,
    )
    another_learner = User(
        email=f"learner-{uuid4().hex}@example.test",
        role="learner",
        is_verified=True,
    )
    certification = Certification(
        name="Computer Science",
        code=f"CS-{uuid4().hex[:10]}",
        passing_threshold_pct=70,
        feedback_mode="immediate",
        is_published=True,
    )
    session.add_all([admin, learner, another_learner, certification])
    session.flush()

    category = Category(
        certification_id=certification.id,
        name="CS Fundamentals",
        is_published=True,
    )
    session.add(category)
    session.flush()

    correct_options: dict[str, str] = {}
    for number in range(1, question_count + 1):
        question = Question(
            certification_id=certification.id,
            category_id=category.id,
            difficulty="easy",
            created_by_id=admin.id,
        )
        session.add(question)
        session.flush()
        version = QuestionVersion(
            question_id=question.id,
            version_number=1,
            question_text=f"Final integration test question {number}?",
            question_type="multiple_choice",
            review_status="approved",
            publication_status="active",
            submitted_by_id=admin.id,
            reviewed_by_id=admin.id,
            reviewed_at=datetime.now(UTC),
        )
        session.add(version)
        session.flush()
        correct = AnswerOption(
            question_version_id=version.id,
            position=1,
            option_text="Correct",
            is_correct=True,
        )
        incorrect = AnswerOption(
            question_version_id=version.id,
            position=2,
            option_text="Incorrect",
            is_correct=False,
        )
        session.add_all([correct, incorrect])
        session.flush()
        correct_options[str(version.id)] = str(correct.id)

    ids = {
        "admin_id": admin.id,
        "learner_id": learner.id,
        "another_learner_id": another_learner.id,
        "certification_id": certification.id,
        "category_id": category.id,
        "correct_options": correct_options,
    }
    session.commit()
    return ids


def _auth(user_id: UUID) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(str(user_id))}"}


def _create(client: TestClient, ids: dict, *, count: int = 2, name: str = "Demo"):
    return client.post(
        f"{API}/admin/practice-exams",
        headers=_auth(ids["admin_id"]),
        json={
            "certification_id": str(ids["certification_id"]),
            "category_id": str(ids["category_id"]),
            "name": name,
            "question_count": count,
        },
    )


def _publish(client: TestClient, ids: dict, exam_id: str, is_published: bool):
    return client.patch(
        f"{API}/admin/practice-exams/{exam_id}/publication",
        headers=_auth(ids["admin_id"]),
        json={"is_published": is_published},
    )


def _start(client: TestClient, ids: dict, exam_id: str, learner_id: UUID):
    return client.post(
        f"{API}/exams",
        headers=_auth(learner_id),
        json={
            "practice_exam_id": exam_id,
            "certification_id": str(ids["certification_id"]),
            "category_id": str(ids["category_id"]),
            "question_count": 2,
        },
    )


def test_real_http_unpublish_keeps_started_attempt_and_results(pg_environment):
    """AC2–AC5: real start, answer, unpublish, finish, grade, and revisit."""
    client, sessions = pg_environment
    with sessions() as session:
        ids = _seed_bank(session)

    insufficient = _create(client, ids, count=3, name="Too Many Questions")
    assert insufficient.status_code == 201, insufficient.text
    insufficient_id = insufficient.json()["id"]
    not_ready = _publish(client, ids, insufficient_id, True)
    assert not_ready.status_code == 409, not_ready.text
    assert not_ready.json()["detail"]["code"] == "PRACTICE_EXAM_NOT_READY"
    assert "INSUFFICIENT_PUBLISHED_QUESTIONS" in {
        issue["code"] for issue in not_ready.json()["detail"]["readiness"]["issues"]
    }

    draft = _create(client, ids, name="Computer Science Practice")
    assert draft.status_code == 201, draft.text
    exam_id = draft.json()["id"]
    assert draft.json()["status"] == "draft"

    blocked_draft = _start(client, ids, exam_id, ids["learner_id"])
    assert blocked_draft.status_code == 409
    assert blocked_draft.json()["detail"]["code"] == "PRACTICE_EXAM_UNAVAILABLE"

    published = _publish(client, ids, exam_id, True)
    assert published.status_code == 200, published.text
    assert published.json()["status"] == "published"
    catalog = client.get(f"{API}/exams/catalog", headers=_auth(ids["learner_id"]))
    assert catalog.status_code == 200
    assert [entry["id"] for entry in catalog.json()["exams"]] == [exam_id]

    started = _start(client, ids, exam_id, ids["learner_id"])
    assert started.status_code == 201, started.text
    attempt_id = started.json()["attempt_id"]
    assert len(started.json()["questions"]) == 2

    first_question = started.json()["questions"][0]
    answer = client.post(
        f"{API}/exams/{attempt_id}/responses/{first_question['id']}/submit",
        headers=_auth(ids["learner_id"]),
        json={
            "selected_option_ids": [
                ids["correct_options"][first_question["id"]]
            ]
        },
    )
    assert answer.status_code == 200, answer.text

    unpublish = _publish(client, ids, exam_id, False)
    assert unpublish.status_code == 200, unpublish.text
    assert unpublish.json()["status"] == "unpublished"
    assert client.get(
        f"{API}/exams/catalog", headers=_auth(ids["another_learner_id"])
    ).json() == {"exams": []}
    blocked_new = _start(client, ids, exam_id, ids["another_learner_id"])
    assert blocked_new.status_code == 409
    assert blocked_new.json()["detail"]["code"] == "PRACTICE_EXAM_UNAVAILABLE"

    resumed = client.get(
        f"{API}/exams/{attempt_id}", headers=_auth(ids["learner_id"])
    )
    assert resumed.status_code == 200, resumed.text
    assert resumed.json()["status"] == "in_progress"

    submitted = client.post(
        f"{API}/exams/{attempt_id}/submit", headers=_auth(ids["learner_id"])
    )
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["status"] == "submitted"

    results_url = f"{API}/exams/{attempt_id}/results"
    results = client.get(results_url, headers=_auth(ids["learner_id"]))
    assert results.status_code == 200, results.text
    assert results.json()["status"] == "submitted"
    assert results.json()["question_count"] == 2
    assert results.json()["correct_count"] == 1
    assert client.get(results_url, headers=_auth(ids["learner_id"])).json() == (
        results.json()
    )

    with sessions() as session:
        assert session.get(ExamAttempt, UUID(attempt_id)).status == "submitted"
        assert session.exec(
            select(ExamResult).where(ExamResult.attempt_id == UUID(attempt_id))
        ).one() is not None
        assert session.get(PracticeExam, UUID(exam_id)).status == "unpublished"

    # AC1/AC6: a learner's attempt to mutate publication changes nothing.
    forbidden = client.patch(
        f"{API}/admin/practice-exams/{exam_id}/publication",
        headers=_auth(ids["another_learner_id"]),
        json={"is_published": True},
    )
    assert forbidden.status_code == 403
    with sessions() as session:
        assert session.get(PracticeExam, UUID(exam_id)).status == "unpublished"


def test_postgres_shared_start_lock_blocks_concurrent_unpublish(pg_environment):
    """AC6: FOR SHARE must block admin FOR UPDATE until attempt commit."""
    client, sessions = pg_environment
    with sessions() as session:
        ids = _seed_bank(session)
    draft = _create(client, ids)
    assert draft.status_code == 201, draft.text
    exam_id = draft.json()["id"]
    assert _publish(client, ids, exam_id, True).status_code == 200

    selecting = Event()
    permit_commit = Event()

    def start_while_paused():
        with sessions() as session:

            class PausedQuestionSelector:
                def select_random_eligible(
                    self, certification_id, question_count, category_id=None
                ):
                    # Called only after the published practice-exam row was
                    # acquired FOR SHARE by PublishedExamService.
                    selecting.set()
                    if not permit_commit.wait(timeout=10):
                        raise RuntimeError("Test failed to resume question selection")
                    return SQLModelQuestionRepository(session).select_random_eligible(
                        certification_id,
                        question_count,
                        category_id=category_id,
                    )

            service = PublishedExamService(session, selector=PausedQuestionSelector())
            return service.create_exam(
                learner_id=ids["learner_id"],
                certification_id=ids["certification_id"],
                category_id=ids["category_id"],
                practice_exam_id=UUID(exam_id),
                question_count=2,
            )

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(start_while_paused)
        try:
            assert selecting.wait(timeout=10), "Start did not acquire its lock"
            with sessions() as session:
                session.exec(text("SET LOCAL lock_timeout = '350ms'"))
                with pytest.raises(OperationalError, match="lock timeout"):
                    set_practice_exam_publication(
                        session, UUID(exam_id), is_published=False
                    )
        finally:
            permit_commit.set()
        created = future.result(timeout=15)

    with sessions() as session:
        assert session.get(ExamAttempt, created.attempt_id).status == "in_progress"
        assert session.get(PracticeExam, UUID(exam_id)).status == "published"

    # After the start commits, unpublish succeeds and blocks all NEW starts.
    assert _publish(client, ids, exam_id, False).status_code == 200
    assert _start(
        client, ids, exam_id, ids["another_learner_id"]
    ).status_code == 409


def test_concurrent_repeated_publication_is_idempotent(pg_environment):
    """AC6: concurrent updates are serialized and cannot duplicate exams."""
    client, sessions = pg_environment
    with sessions() as session:
        ids = _seed_bank(session)
    draft = _create(client, ids)
    assert draft.status_code == 201, draft.text
    exam_id = UUID(draft.json()["id"])

    def apply(desired: bool):
        with sessions() as session:
            return set_practice_exam_publication(
                session, exam_id, is_published=desired
            ).status

    for desired, expected in ((True, "published"), (False, "unpublished")):
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(apply, (desired, desired)))
        assert results == [expected, expected]
        with sessions() as session:
            assert session.get(PracticeExam, exam_id).status == expected
            assert len(session.exec(select(PracticeExam)).all()) == 1
