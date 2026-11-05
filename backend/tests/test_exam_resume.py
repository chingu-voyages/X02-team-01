"""AC5: learner-owned attempts can be reopened safely and in saved order."""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.api.v1.endpoints.exams import get_exam_attempt_service, get_exam_service
from app.core.security import create_access_token
from app.main import app
from app.services.exam_service import (
    ExamAttemptNotFoundError,
    ExamOptionContent,
    ExamQuestionContent,
)


class StubResumeService:
    def __init__(self, learner_id, attempt_id, cert_id):
        self.learner_id = learner_id
        self.attempt_id = attempt_id
        self.cert_id = cert_id
        self.queries = []
        self.retrieved = []

    def get_owned_attempt(self, *, attempt_id, learner_id):
        self.queries.append((attempt_id, learner_id))
        if learner_id != self.learner_id or attempt_id != self.attempt_id:
            raise ExamAttemptNotFoundError("not found")
        return SimpleNamespace(
            id=self.attempt_id,
            certification_id=self.cert_id,
            status="in_progress",
            question_count=2,
            current_position=2,
        )

    def get_exam_questions(self, attempt_id):
        self.retrieved.append(attempt_id)
        return [
            ExamQuestionContent(
                id=uuid4(),
                position=i,
                question_text=f"Question {i} — Σπ",
                question_type="multiple_choice",
                allows_multiple_answers=False,
                difficulty="easy",
                options=[ExamOptionContent(id=uuid4(), position=1, option_text="A")],
            )
            for i in (1, 2)
        ]


def auth(learner):
    return {"Authorization": f"Bearer {create_access_token(str(learner))}"}


@pytest.fixture
def resume_api():
    learner_id, attempt_id, cert_id = uuid4(), uuid4(), uuid4()
    service = StubResumeService(learner_id, attempt_id, cert_id)
    app.dependency_overrides[get_exam_service] = lambda: service
    app.dependency_overrides[get_exam_attempt_service] = lambda: SimpleNamespace(
        response_blocks=lambda attempt: {},
        answer_counts=lambda attempt: (0, 2),
    )
    try:
        with TestClient(app) as client:
            yield client, service, learner_id, attempt_id
    finally:
        app.dependency_overrides.pop(get_exam_service, None)
        app.dependency_overrides.pop(get_exam_attempt_service, None)


def test_owner_can_resume_original_order(resume_api):
    client, stub, learner, attempt_id = resume_api
    response = client.get(f"/api/v1/exams/{attempt_id}", headers=auth(learner))
    assert response.status_code == 200
    data = response.json()
    assert data["attempt_id"] == str(attempt_id)
    assert data["current_position"] == 2
    assert [q["position"] for q in data["questions"]] == [1, 2]
    assert all(q["images"] == [] for q in data["questions"])
    assert "is_correct" not in response.text
    assert "expected_answer" not in response.text
    assert stub.retrieved == [attempt_id]


def test_other_learner_cannot_read_attempt(resume_api):
    client, stub, _, attempt_id = resume_api
    response = client.get(f"/api/v1/exams/{attempt_id}", headers=auth(uuid4()))
    assert response.status_code == 404
    assert stub.retrieved == []


def test_unknown_attempt_is_indistinguishable_from_foreign(resume_api):
    client, stub, learner, _ = resume_api
    response = client.get(f"/api/v1/exams/{uuid4()}", headers=auth(learner))
    assert response.status_code == 404
    assert stub.retrieved == []


def test_missing_or_malformed_authentication_is_rejected(resume_api):
    client, stub, _, attempt_id = resume_api
    assert client.get(f"/api/v1/exams/{attempt_id}").status_code == 401
    assert (
        client.get(
            f"/api/v1/exams/{attempt_id}", headers={"Authorization": "Bearer invalid"}
        ).status_code
        == 401
    )
    assert stub.retrieved == []


def test_malformed_attempt_id_is_rejected(resume_api):
    client, stub, learner, _ = resume_api
    response = client.get("/api/v1/exams/nope", headers=auth(learner))
    assert response.status_code == 422
    assert stub.retrieved == []


class StubResumeServiceWithSavedAnswers(StubResumeService):
    """Same fake, but one question carries a saved response block.

    Mirrors the crash property of the GET resume endpoint: attaching a
    response to the returned content must not raise FrozenInstanceError on
    attempts that actually carry saved answers (the JHEP-35-era bug caught
    during live verification).
    """

    def __init__(self, learner_id, attempt_id, cert_id):
        super().__init__(learner_id, attempt_id, cert_id)
        self.pinned_version_id = uuid4()

    def response_blocks(self, attempt):  # type: ignore[override]
        return {
            self.pinned_version_id: {
                "question_version_id": self.pinned_version_id,
                "selected_option_ids": None,
                "text_response": "My own words",
                "is_submitted": True,
                "answered_at": "2026-11-05T14:01:00Z",
                "question_submitted_at": "2026-11-05T14:02:00Z",
            }
        }

    def get_exam_questions(self, attempt_id):  # type: ignore[override]
        # One question whose id MATCHES the saved response's version id,
        # so the endpoint binds the block - exactly what a resumed
        # attempt does.
        question = ExamQuestionContent(
            id=self.pinned_version_id,
            position=1,
            question_text="Saved-answer question",
            question_type="multiple_choice",
            allows_multiple_answers=False,
            difficulty="easy",
            options=[ExamOptionContent(id=uuid4(), position=1, option_text="A")],
        )
        return [question]


@pytest.fixture
def resume_api_with_saved_answers():
    learner_id, attempt_id, cert_id = uuid4(), uuid4(), uuid4()
    exam_service = StubResumeServiceWithSavedAnswers(learner_id, attempt_id, cert_id)
    app.dependency_overrides[get_exam_service] = lambda: exam_service
    app.dependency_overrides[get_exam_attempt_service] = lambda: exam_service
    try:
        with TestClient(app) as client:
            yield client, exam_service, learner_id, attempt_id
    finally:
        app.dependency_overrides.pop(get_exam_service, None)
        app.dependency_overrides.pop(get_exam_attempt_service, None)


def test_resume_with_saved_answers_returns_200_and_echoes_response(
    resume_api_with_saved_answers,
):
    """JHEP-32 regression: previously, viewing an attempt that has a saved
    response raised FrozenInstanceError (500). The endpoint must convert to
    the mutable response model and echo the block instead."""
    client, _, learner_id, attempt_id = resume_api_with_saved_answers
    response = client.get(f"/api/v1/exams/{attempt_id}", headers=auth(learner_id))
    assert response.status_code == 200

    data = response.json()
    saved = [q for q in data["questions"] if q.get("response")]
    assert len(saved) == 1

    block = saved[0]["response"]
    assert block["question_version_id"] == saved[0]["id"]
    assert block["is_submitted"] is True
    assert block["text_response"] == "My own words"
    # Pre-submission attempt: correctness must not be echoed (AC4).
    assert "is_correct" not in block
