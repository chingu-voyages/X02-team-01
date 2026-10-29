"""AC5: learner-owned attempts can be reopened safely and in saved order."""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.api.v1.endpoints.exams import get_exam_service
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
    try:
        with TestClient(app) as client:
            yield client, service, learner_id, attempt_id
    finally:
        app.dependency_overrides.pop(get_exam_service, None)


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
