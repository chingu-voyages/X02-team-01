"""JHEP-89 recovery discovery: authentication, privacy, and pinned progress."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from learner_auth_fixtures import issue_learner_token
from sqlalchemy.exc import SQLAlchemyError
from test_exam_responses_db import SeededAttempt, postgres_session  # noqa: F401

from app.api.v1.endpoints import learner_practice_exams
from app.main import app
from app.models import Category, ExamAttempt, PracticeExam, User
from app.repositories.unfinished_exam_repository import list_unfinished_exams
from app.schemas.unfinished_exam import UnfinishedExamOut
from app.services.exam_attempt_service import ExamAttemptService

URL = "/api/v1/exams/unfinished"


def test_listing_requires_authentication_and_passes_only_authenticated_subject(
    stub_learner_database, monkeypatch
):
    owner = uuid4()
    other = uuid4()
    attempt_id = uuid4()
    summary = UnfinishedExamOut(
        attempt_id=attempt_id,
        practice_exam_id=None,
        certification_name="Legacy certification",
        category_name=None,
        name=None,
        question_count=3,
        submitted_count=1,
        current_position=2,
        started_at=datetime.now(UTC),
    )
    calls = []

    def list_for_owner(_session, learner_id):
        calls.append(learner_id)
        return [summary] if learner_id == owner else []

    monkeypatch.setattr(learner_practice_exams, "list_unfinished_exams", list_for_owner)
    headers = {"Authorization": f"Bearer {issue_learner_token(str(owner))}"}
    other_headers = {"Authorization": f"Bearer {issue_learner_token(str(other))}"}
    with TestClient(app) as client:
        assert client.get(URL).status_code == 401
        response = client.get(URL, headers=headers)
        assert response.status_code == 200, response.text
        assert response.headers["cache-control"] == "no-store"
        assert response.json() == {"attempts": [summary.model_dump(mode="json")]}
        # Query parameters cannot override the authenticated owner.
        assert client.get(
            f"{URL}?learner_id={owner}", headers=other_headers
        ).json() == {"attempts": []}
    assert calls == [owner, other]


def test_listing_reports_database_failure_instead_of_empty_list(
    stub_learner_database, monkeypatch
):
    def unavailable(_session, _learner_id):
        raise SQLAlchemyError("internal database details")

    monkeypatch.setattr(learner_practice_exams, "list_unfinished_exams", unavailable)
    headers = {"Authorization": f"Bearer {issue_learner_token(str(uuid4()))}"}
    with TestClient(app) as client:
        response = client.get(URL, headers=headers)
    assert response.status_code == 503
    assert "internal database details" not in response.text


def test_postgres_listing_preserves_pinned_count_and_excludes_foreign_and_completed(
    postgres_session,  # noqa: F811
):
    session = postgres_session
    bank = SeededAttempt(session)
    first = bank.add_question(correct_positions=(1,))
    second = bank.add_question(correct_positions=(1,))
    created = bank.create_attempt([(first[0], first[1]), (second[0], second[1])])
    attempt = session.get(ExamAttempt, created.attempt_id)
    assert attempt is not None
    category = Category(certification_id=bank.cert.id, name="Recovery")
    session.add(category)
    session.flush()
    # Current catalog configuration is no longer startable and differs from
    # the pinned two-question attempt. Recovery must ignore those gates.
    configured = PracticeExam(
        certification_id=bank.cert.id,
        category_id=category.id,
        name="Saved practice",
        question_count=3,
        status="unpublished",
    )
    session.add(configured)
    session.flush()
    attempt.practice_exam_id = configured.id
    session.add(attempt)
    session.commit()

    service = ExamAttemptService(session)
    service.submit_question(
        attempt, first[1], selected_option_ids=[first[2][0]], text_response=None
    )
    service.save_response(
        attempt, second[1], selected_option_ids=[second[2][0]], text_response=None
    )
    service.apply_progress(attempt, 2)

    other = User(email=f"other-{uuid4().hex}@example.test")
    session.add(other)
    session.flush()
    foreign = ExamAttempt(
        user_id=other.id,
        certification_id=bank.cert.id,
        practice_exam_id=configured.id,
        question_count=1,
    )
    completed = ExamAttempt(
        user_id=bank.learner.id,
        certification_id=bank.cert.id,
        practice_exam_id=configured.id,
        question_count=1,
        status="submitted",
        submitted_at=datetime.now(UTC),
    )
    legacy = ExamAttempt(
        user_id=bank.learner.id, certification_id=bank.cert.id, question_count=1
    )
    session.add_all([foreign, completed, legacy])
    session.commit()

    results = {
        item.attempt_id: item
        for item in list_unfinished_exams(session, bank.learner.id)
    }
    assert set(results) == {attempt.id, legacy.id}
    saved = results[attempt.id]
    assert saved.practice_exam_id == configured.id
    assert saved.name == "Saved practice"
    assert saved.category_name == "Recovery"
    assert saved.question_count == 2
    assert saved.submitted_count == 1
    assert saved.current_position == 2
    assert results[legacy.id].practice_exam_id is None
    assert results[legacy.id].name is None
    assert results[legacy.id].submitted_count == 0
    assert [item.attempt_id for item in list_unfinished_exams(session, other.id)] == [
        foreign.id
    ]
    assert list_unfinished_exams(session, UUID(int=0)) == []
