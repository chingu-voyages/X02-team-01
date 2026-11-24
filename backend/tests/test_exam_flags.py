"""JHEP-104 flag endpoint contract and authorization tests."""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.api.v1.endpoints.exams import get_exam_attempt_service, get_exam_service
from app.core.security import create_access_token
from app.main import app
from app.services.exam_attempt_service import (
    AttemptAlreadySubmittedError,
    AttemptQuestionNotFoundError,
)
from app.services.exam_service import (
    ExamAttemptNotFoundError,
    ExamOptionContent,
    ExamQuestionContent,
)


class FlagServiceStub:
    def __init__(self):
        self.learner_id = uuid4()
        self.attempt = SimpleNamespace(
            id=uuid4(),
            certification_id=uuid4(),
            status="in_progress",
            question_count=1,
            current_position=1,
            user_id=self.learner_id,
        )
        self.question = SimpleNamespace(
            id=uuid4(),
            question_version_id=uuid4(),
            flagged_for_review=False,
        )
        self.calls = []

    def get_owned_attempt(self, *, attempt_id, learner_id):
        if attempt_id != self.attempt.id or learner_id != self.learner_id:
            raise ExamAttemptNotFoundError("not found")
        return self.attempt

    def set_question_flag(self, attempt, question_key, *, flagged_for_review):
        if attempt.status != "in_progress":
            raise AttemptAlreadySubmittedError("already submitted")
        if question_key not in (self.question.id, self.question.question_version_id):
            raise AttemptQuestionNotFoundError("not found")
        self.calls.append((attempt.id, question_key, flagged_for_review))
        self.question.flagged_for_review = flagged_for_review
        return self.question

    def get_exam_questions(self, attempt_id):
        assert attempt_id == self.attempt.id
        return [
            ExamQuestionContent(
                id=self.question.question_version_id,
                position=1,
                question_text="Which option is correct?",
                question_type="multiple_choice",
                allows_multiple_answers=False,
                difficulty="easy",
                options=[ExamOptionContent(uuid4(), 1, "Option A")],
                flagged_for_review=self.question.flagged_for_review,
            )
        ]

    def response_blocks(self, attempt):
        return {}


def auth(learner_id):
    return {"Authorization": f"Bearer {create_access_token(str(learner_id))}"}


def flag_url(attempt_id, question_id):
    return f"/api/v1/exams/{attempt_id}/questions/{question_id}/flag"


@pytest.fixture
def flag_api():
    stub = FlagServiceStub()
    app.dependency_overrides[get_exam_service] = lambda: stub
    app.dependency_overrides[get_exam_attempt_service] = lambda: stub
    try:
        with TestClient(app) as client:
            yield client, stub
    finally:
        app.dependency_overrides.pop(get_exam_service, None)
        app.dependency_overrides.pop(get_exam_attempt_service, None)


@pytest.mark.parametrize("key", ["id", "question_version_id"])
def test_flag_unflag_and_retrieve_attempt(flag_api, key):
    client, stub = flag_api
    headers = auth(stub.learner_id)
    question_key = getattr(stub.question, key)
    url = flag_url(stub.attempt.id, question_key)
    for flagged in (True, True, False, False):
        response = client.put(
            url, json={"flagged_for_review": flagged}, headers=headers
        )
        assert response.status_code == 200
        assert response.json() == {
            "attempt_id": str(stub.attempt.id),
            "question_version_id": str(stub.question.question_version_id),
            "flagged_for_review": flagged,
        }
        loaded = client.get(f"/api/v1/exams/{stub.attempt.id}", headers=headers)
        assert loaded.status_code == 200
        question = loaded.json()["questions"][0]
        assert question["flagged_for_review"] is flagged
        assert "response" not in question
        assert "is_correct" not in question
        assert "explanation" not in question


def test_flag_requires_authentication(flag_api):
    client, stub = flag_api
    response = client.put(
        flag_url(stub.attempt.id, stub.question.id),
        json={"flagged_for_review": True},
    )
    assert response.status_code == 401
    assert stub.calls == []


def test_flag_rejects_foreign_attempts_and_unknown_questions(flag_api):
    client, stub = flag_api
    for attempt_id, question_id, learner in (
        (stub.attempt.id, stub.question.id, uuid4()),
        (uuid4(), stub.question.id, stub.learner_id),
        (stub.attempt.id, uuid4(), stub.learner_id),
    ):
        response = client.put(
            flag_url(attempt_id, question_id),
            json={"flagged_for_review": True},
            headers=auth(learner),
        )
        assert response.status_code == 404
        assert response.json() == {"detail": "Exam attempt not found"}
    assert stub.calls == []


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"flagged_for_review": "true"},
        {"flagged_for_review": 1},
        {"flagged_for_review": None},
        {"flagged_for_review": True, "is_submitted": True},
    ],
)
def test_flag_requires_explicit_boolean(flag_api, payload):
    client, stub = flag_api
    response = client.put(
        flag_url(stub.attempt.id, stub.question.id),
        json=payload,
        headers=auth(stub.learner_id),
    )
    assert response.status_code == 422
    assert stub.calls == []


def test_flag_rejects_finalized_attempt(flag_api):
    client, stub = flag_api
    stub.attempt.status = "submitted"
    response = client.put(
        flag_url(stub.attempt.id, stub.question.id),
        json={"flagged_for_review": True},
        headers=auth(stub.learner_id),
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Attempt already submitted"
    assert stub.calls == []
