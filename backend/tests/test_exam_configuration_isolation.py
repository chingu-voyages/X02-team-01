"""JHEP-107 AC6: reconfiguration changes future attempts, never history.

The SQLite tests exercise real HTTP routes and persisted question assignments.
The opt-in PostgreSQL tests also exercise saved responses, flags, navigation,
real grading, and retakes (ExamResponse uses PostgreSQL-specific JSONB).
"""

import os
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from admin_auth_fixtures import domain_access_token, make_domain_user
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event, text
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.api.v1.endpoints import (
    admin_practice_exams,
    exams,
    learner_practice_exams,
)
from app.db.session import get_session
from app.models import (
    AnswerOption,
    Category,
    Certification,
    ExamAttempt,
    ExamAttemptQuestion,
    ExamQuestionGrade,
    ExamResult,
    PracticeExam,
    Question,
    QuestionImage,
    QuestionVersion,
    User,
)

ADMIN = "/api/v1/admin/practice-exams"
EXAMS = "/api/v1/exams"


@contextmanager
def _api(session: Session) -> Iterator[TestClient]:
    """Use the real router, auth dependency, and services with isolated data."""
    app = FastAPI()
    app.include_router(learner_practice_exams.router, prefix=EXAMS)
    app.include_router(exams.router, prefix=EXAMS)
    app.include_router(admin_practice_exams.router, prefix=ADMIN)

    def override_session() -> Iterator[Session]:
        yield session

    app.dependency_overrides[get_session] = override_session
    with TestClient(app) as client:
        yield client


@pytest.fixture
def sqlite_environment() -> Iterator[tuple[TestClient, Session]]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _record):
        connection.execute("PRAGMA foreign_keys=ON")

    # Same portable table subset as test_learner_published_exams.py.
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
    try:
        with Session(engine) as session, _api(session) as client:
            yield client, session
    finally:
        engine.dispose()


@pytest.fixture
def postgres_environment() -> Iterator[tuple[TestClient, Session]]:
    if os.getenv("RUN_DB_INTEGRATION") != "1":
        pytest.skip("PostgreSQL integration tests are opt-in")

    from app.db.session import engine

    if engine.url.get_backend_name() != "postgresql":
        pytest.fail("PostgreSQL integration tests require PostgreSQL")
    if engine.url.host not in ("localhost", "127.0.0.1", None):
        pytest.fail("Refusing to run integration tests on a remote PostgreSQL host")

    schema = f"jhep107_config_{uuid4().hex[:12]}"
    with engine.connect() as connection:
        outer = connection.begin()
        try:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
            scoped = connection.execution_options(schema_translate_map={None: schema})
            SQLModel.metadata.create_all(scoped)
            with (
                Session(
                    bind=scoped, join_transaction_mode="create_savepoint"
                ) as session,
                _api(session) as client,
            ):
                yield client, session
        finally:
            outer.rollback()


def _user(session: Session, role: str = "learner") -> User:
    user = make_domain_user(
        email=f"{uuid4()}@example.test", role=role, is_verified=True
    )
    session.add(user)
    session.commit()
    return user


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {domain_access_token(user)}"}


def _request(client, method, url, headers, *, expected=200, **kwargs):
    response = client.request(method, url, headers=headers, **kwargs)
    assert response.status_code == expected, response.text
    return response.json()


def _seed_bank(session: Session, admin: User, *, feedback_mode: str = "deferred"):
    """Three eligible, independently pinned multiple-choice questions."""
    cert = Certification(
        name="Configuration Isolation",
        code=f"CS-{uuid4().hex[:8]}",
        is_published=True,
        passing_threshold_pct=70,
        feedback_mode=feedback_mode,
    )
    session.add(cert)
    session.flush()
    category = Category(
        certification_id=cert.id, name="Fundamentals", is_published=True
    )
    session.add(category)
    session.flush()

    for index in range(3):
        question = Question(
            certification_id=cert.id,
            category_id=category.id,
            difficulty="easy",
            created_by_id=admin.id,
        )
        session.add(question)
        session.flush()
        version = QuestionVersion(
            question_id=question.id,
            version_number=1,
            question_text=f"Configuration isolation question {index + 1}?",
            question_type="multiple_choice",
            allows_multiple_answers=False,
            review_status="approved",
            publication_status="active",
            submitted_by_id=admin.id,
            reviewed_by_id=admin.id,
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
    return {
        "certification_id": str(cert.id),
        "category_id": str(category.id),
        "name": "Configuration isolation exam",
    }


def _create_and_publish(client, headers, config, count):
    draft = _request(
        client,
        "POST",
        ADMIN,
        headers,
        expected=201,
        json={**config, "question_count": count},
    )
    assert draft["status"] == "draft"
    assert _publication(client, headers, draft["id"], True)["status"] == "published"
    return draft["id"]


def _publication(client, headers, exam_id, is_published):
    return _request(
        client,
        "PATCH",
        f"{ADMIN}/{exam_id}/publication",
        headers,
        json={"is_published": is_published},
    )


def _configure(client, headers, exam_id, config, count):
    updated = _request(
        client,
        "PUT",
        f"{ADMIN}/{exam_id}",
        headers,
        json={**config, "question_count": count},
    )
    assert updated["id"] == exam_id
    assert updated["question_count"] == count
    assert updated["status"] == "unpublished"
    assert updated["readiness"]["ready"] is True
    assert updated["readiness"]["required_question_count"] == count
    return updated


def _start(client, headers, exam_id, config, count, *, expected=201):
    return _request(
        client,
        "POST",
        EXAMS,
        headers,
        expected=expected,
        json={
            "practice_exam_id": exam_id,
            "certification_id": config["certification_id"],
            "category_id": config["category_id"],
            "question_count": count,
        },
    )


def _catalog_count(client, headers, exam_id):
    entries = _request(client, "GET", f"{EXAMS}/catalog", headers)["exams"]
    matches = [entry for entry in entries if entry["id"] == exam_id]
    assert len(matches) == 1
    return matches[0]["question_count"]


def _assignment_snapshot(session, attempt_id):
    rows = session.exec(
        select(ExamAttemptQuestion)
        .where(ExamAttemptQuestion.attempt_id == UUID(attempt_id))
        .order_by(ExamAttemptQuestion.position)
    ).all()
    return [
        (row.id, row.question_id, row.question_version_id, row.position) for row in rows
    ]


def _assert_attempt_length(attempt, expected_count):
    assert attempt["question_count"] == expected_count
    assert len(attempt["questions"]) == expected_count
    assert [q["position"] for q in attempt["questions"]] == list(
        range(1, expected_count + 1)
    )
    assert len({q["id"] for q in attempt["questions"]}) == expected_count


@pytest.mark.parametrize(("original_count", "updated_count"), [(2, 3), (3, 1)])
def test_configuration_change_preserves_attempt_and_blocks_stale_starts(
    sqlite_environment, original_count, updated_count
):
    """AC3/5/6/7: verify both increases and decreases in fast API tests."""
    client, session = sqlite_environment
    admin = _user(session, "administrator")
    learner = _user(session)
    newcomer = _user(session)
    admin_headers, learner_headers, newcomer_headers = (
        _headers(admin),
        _headers(learner),
        _headers(newcomer),
    )
    config = _seed_bank(session, admin)
    exam_id = _create_and_publish(client, admin_headers, config, original_count)
    assert _catalog_count(client, learner_headers, exam_id) == original_count

    original = _start(client, learner_headers, exam_id, config, original_count)
    _assert_attempt_length(original, original_count)
    attempt_id = original["attempt_id"]
    before = _assignment_snapshot(session, attempt_id)
    assert [str(row[2]) for row in before] == [q["id"] for q in original["questions"]]

    assert (
        _publication(client, admin_headers, exam_id, False)["status"] == "unpublished"
    )
    unavailable = _start(
        client, newcomer_headers, exam_id, config, original_count, expected=409
    )
    assert unavailable["detail"]["code"] == "PRACTICE_EXAM_UNAVAILABLE"
    assert _request(client, "GET", f"{EXAMS}/catalog", newcomer_headers) == {
        "exams": []
    }

    _configure(client, admin_headers, exam_id, config, updated_count)
    assert _publication(client, admin_headers, exam_id, True)["status"] == "published"
    assert _catalog_count(client, newcomer_headers, exam_id) == updated_count

    stale = _start(
        client, newcomer_headers, exam_id, config, original_count, expected=409
    )
    assert stale["detail"]["code"] == "PRACTICE_EXAM_COUNT_MISMATCH"
    assert stale["detail"]["expected"] == updated_count
    assert stale["detail"]["received"] == original_count

    conflict = _start(
        client, learner_headers, exam_id, config, updated_count, expected=409
    )
    assert conflict["detail"]["code"] == "ATTEMPT_IN_PROGRESS"
    assert conflict["detail"]["attempt_id"] == attempt_id
    assert len(session.exec(select(ExamAttempt)).all()) == 1

    fresh = _start(client, newcomer_headers, exam_id, config, updated_count)
    _assert_attempt_length(fresh, updated_count)
    assert fresh["attempt_id"] != attempt_id
    assert len(session.exec(select(ExamAttempt)).all()) == 2

    persisted = session.get(ExamAttempt, UUID(attempt_id))
    assert persisted is not None
    session.refresh(persisted)
    assert persisted.status == "in_progress"
    assert persisted.question_count == original_count
    assert str(persisted.practice_exam_id) == exam_id
    assert _assignment_snapshot(session, attempt_id) == before


def _answer_correctly(client, session, headers, attempt_id, question):
    correct_id = session.exec(
        select(AnswerOption.id).where(
            AnswerOption.question_version_id == UUID(question["id"]),
            AnswerOption.is_correct.is_(True),
        )
    ).one()
    _request(
        client,
        "POST",
        f"{EXAMS}/{attempt_id}/responses/{question['id']}/submit",
        headers,
        json={"selected_option_ids": [str(correct_id)]},
    )
    return str(correct_id)


def _finish(client, headers, attempt_id, count):
    completed = _request(client, "POST", f"{EXAMS}/{attempt_id}/submit", headers)
    assert completed["question_count"] == count
    assert completed["status"] == "submitted"
    result = _request(client, "GET", f"{EXAMS}/{attempt_id}/results", headers)
    assert result["grading_complete"] is True
    assert result["question_count"] == count
    assert result["points_possible"] == count
    assert result["points_earned"] == count
    assert result["score_percent"] == 100
    assert result["passed"] is True
    return result


def _grade_snapshot(session, attempt_id):
    rows = session.exec(
        select(ExamQuestionGrade).where(
            ExamQuestionGrade.attempt_id == UUID(attempt_id)
        )
    ).all()
    return {
        (
            row.id,
            row.question_id,
            row.question_version_id,
            row.outcome,
            row.points_earned,
        )
        for row in rows
    }


@pytest.mark.parametrize("feedback_mode", ["immediate", "deferred"])
def test_configuration_change_preserves_saved_work_and_completed_results(
    postgres_environment, feedback_mode
):
    """AC6: actual response and grading persistence across a reconfiguration."""
    client, session = postgres_environment
    admin = _user(session, "administrator")
    active_user = _user(session)
    finished_user = _user(session)
    admin_headers = _headers(admin)
    active_headers = _headers(active_user)
    finished_headers = _headers(finished_user)
    config = _seed_bank(session, admin, feedback_mode=feedback_mode)
    exam_id = _create_and_publish(client, admin_headers, config, 2)

    # Generate a genuine completed result before changing the configuration.
    old = _start(client, finished_headers, exam_id, config, 2)
    old_id = old["attempt_id"]
    for question in old["questions"]:
        _answer_correctly(client, session, finished_headers, old_id, question)
    old_result = _finish(client, finished_headers, old_id, 2)
    old_grades = _grade_snapshot(session, old_id)
    assert len(old_grades) == 2
    old_assignments = _assignment_snapshot(session, old_id)
    old_attempt_snapshot = _request(
        client, "GET", f"{EXAMS}/{old_id}", finished_headers
    )

    # A separate learner saves an answer and navigates to a flagged question.
    active = _start(client, active_headers, exam_id, config, 2)
    active_id = active["attempt_id"]
    first, second = active["questions"]
    selected_id = _answer_correctly(client, session, active_headers, active_id, first)
    _request(
        client,
        "PUT",
        f"{EXAMS}/{active_id}/questions/{second['id']}/flag",
        active_headers,
        json={"flagged_for_review": True},
    )
    _request(
        client,
        "PATCH",
        f"{EXAMS}/{active_id}/progress",
        active_headers,
        json={"current_position": 2},
    )
    active_before = _request(client, "GET", f"{EXAMS}/{active_id}", active_headers)
    assert active_before["current_position"] == 2
    assert active_before["questions"][0]["response"]["selected_option_ids"] == [
        selected_id
    ]
    assert active_before["questions"][0]["response"]["is_submitted"] is True
    assert active_before["questions"][1]["flagged_for_review"] is True
    active_assignments = _assignment_snapshot(session, active_id)

    _publication(client, admin_headers, exam_id, False)
    _configure(client, admin_headers, exam_id, config, 3)

    # Existing attempts can still be resumed while the exam is unpublished.
    assert (
        _request(client, "GET", f"{EXAMS}/{active_id}", active_headers) == active_before
    )
    assert (
        _request(client, "GET", f"{EXAMS}/{old_id}/results", finished_headers)
        == old_result
    )

    _publication(client, admin_headers, exam_id, True)
    assert _catalog_count(client, active_headers, exam_id) == 3
    assert (
        _request(client, "GET", f"{EXAMS}/{active_id}", active_headers) == active_before
    )
    assert _assignment_snapshot(session, active_id) == active_assignments

    # An existing attempt for the exact exam remains the only active attempt.
    conflict = _start(client, active_headers, exam_id, config, 3, expected=409)
    assert conflict["detail"]["code"] == "ATTEMPT_IN_PROGRESS"
    assert conflict["detail"]["attempt_id"] == active_id

    # A completed learner can retake using the newly published length.
    retake = _start(client, finished_headers, exam_id, config, 3)
    _assert_attempt_length(retake, 3)
    assert retake["attempt_id"] != old_id
    fresh_retake = _request(
        client, "GET", f"{EXAMS}/{retake['attempt_id']}", finished_headers
    )
    assert all(
        not q.get("response") and not q["flagged_for_review"]
        for q in fresh_retake["questions"]
    )

    # The earlier result, answers, question assignments, and grades did not move.
    assert (
        _request(client, "GET", f"{EXAMS}/{old_id}", finished_headers)
        == old_attempt_snapshot
    )
    assert (
        _request(client, "GET", f"{EXAMS}/{old_id}/results", finished_headers)
        == old_result
    )
    assert _assignment_snapshot(session, old_id) == old_assignments
    assert _grade_snapshot(session, old_id) == old_grades

    # The active learner can finish on the original length and retake later.
    _answer_correctly(client, session, active_headers, active_id, second)
    _finish(client, active_headers, active_id, 2)
    active_retake = _start(client, active_headers, exam_id, config, 3)
    _assert_attempt_length(active_retake, 3)
    assert active_retake["attempt_id"] != active_id
