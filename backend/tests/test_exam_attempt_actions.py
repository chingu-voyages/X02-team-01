"""JHEP-32/34/35 endpoint wiring: saved answers, submits, results.

Fast tests with stubbed services — they verify route behavior, ownership
semantics, error mapping, and feedback-mode payload gating. Real
persistence and constraint coverage lives in the opt-in PostgreSQL suite
(test_exam_responses_db.py).
"""

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app.api.v1.endpoints.exams import (
    get_exam_attempt_service,
    get_exam_service,
)
from app.core.security import create_access_token
from app.main import app
from app.services.exam_attempt_service import (
    AttemptAlreadySubmittedError,
    AttemptQuestionNotFoundError,
    InvalidResponseContentError,
    NoAnswerContentError,
    QuestionAlreadyLockedError,
)
from app.services.exam_service import (
    ExamAttemptNotFoundError,
    ExamOptionContent,
    ExamQuestionContent,
)
from app.services.grading_service import AttemptNotSubmittedError

EXAM_URL = "/api/v1/exams"


def auth(learner_id) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(str(learner_id))}"}


def _question(version_id=None):
    version_id = version_id or uuid4()
    return ExamQuestionContent(
        id=version_id,
        position=1,
        question_text="What is the goal?",
        question_type="multiple_choice",
        allows_multiple_answers=False,
        difficulty="easy",
        options=[ExamOptionContent(id=uuid4(), position=1, option_text="A")],
    )


class StubExamService:
    """Ownership gate mirroring the real ExamService behavior."""

    def __init__(self, attempt_id, learner_id, cert_id=None):
        self.attempt_id = attempt_id
        self.learner_id = learner_id
        self.cert_id = cert_id or uuid4()

    def get_owned_attempt(self, *, attempt_id, learner_id):
        if learner_id != self.learner_id or attempt_id != self.attempt_id:
            raise ExamAttemptNotFoundError("not found")
        return SimpleNamespace(
            id=self.attempt_id,
            certification_id=self.cert_id,
            status="in_progress",
            question_count=2,
            current_position=1,
            passing_threshold_pct=70,
            feedback_mode="deferred",
            user_id=self.learner_id,
            submitted_at=None,
        )

    def get_exam_questions(self, attempt_id):
        return [_question()]


class StubAttemptService:
    """Duck-typed stand-in for ExamAttemptService with canned outcomes."""

    def __init__(self, error=None):
        self.error = error
        self.saved = []
        self.questions_submitted = []
        self.submitted = False
        self.progress = []

    def response_blocks(self, attempt):
        return {}

    def answer_counts(self, attempt):
        return (1, 1)

    def save_response(self, attempt, question_version_id, **kwargs):
        if self.error is not None:
            raise self.error
        self.saved.append((attempt.id, question_version_id, kwargs))
        return SimpleNamespace(
            attempt_id=attempt.id,
            question_version_id=question_version_id,
            selected_option_ids=[str(o) for o in kwargs["selected_option_ids"]]
            if kwargs["selected_option_ids"]
            else None,
            text_response=kwargs["text_response"],
            is_submitted=False,
            answered_at=datetime.now(UTC),
            is_correct=None,
        )

    def submit_question(self, attempt, question_version_id, **kwargs):
        if self.error is not None:
            raise self.error
        self.questions_submitted.append((attempt.id, question_version_id, kwargs))
        return {
            "question_submitted_at": datetime.now(UTC),
            "feedback_released": False,
            "is_correct": None,
            "correct_option_ids": None,
            "explanation": None,
        }

    def apply_progress(self, attempt, current_position):
        if self.error is not None:
            raise self.error
        self.progress.append(current_position)
        attempt.current_position = current_position

    def final_submit(self, attempt):
        if self.error is not None:
            raise self.error
        self.submitted = True
        attempt.status = "submitted"
        attempt.submitted_at = datetime.now(UTC)
        return SimpleNamespace(
            points_earned=1,
            points_possible=2,
            score_pct=50.0,
            passed=False,
            graded_at=datetime.now(UTC),
        )

    def results_payload(self, attempt):
        if self.error is not None:
            raise self.error
        return {
            "attempt_id": attempt.id,
            "certification_id": attempt.certification_id,
            "status": "submitted",
            "question_count": 2,
            "answered_count": 1,
            "unanswered_count": 1,
            "correct_count": 1,
            "incorrect_count": 0,
            "unanswered_graded_count": 1,
            "ungraded_count": 0,
            "ungradable_count": 0,
            "graded_count": 2,
            "points_earned": 1,
            "points_possible": 2,
            "score_percent": 50.0,
            "score_basis": "graded_questions_only",
            "passing_score_percent": 70,
            "passed": False,
            "grading_complete": True,
            "submitted_at": datetime.now(UTC),
            "graded_at": datetime.now(UTC),
        }


@pytest.fixture
def api():
    learner_id, attempt_id = uuid4(), uuid4()
    exam_service = StubExamService(attempt_id, learner_id)
    attempt_service = StubAttemptService()
    app.dependency_overrides[get_exam_service] = lambda: exam_service
    app.dependency_overrides[get_exam_attempt_service] = lambda: attempt_service
    try:
        with TestClient(app) as client:
            yield client, attempt_service, learner_id, attempt_id
    finally:
        app.dependency_overrides.pop(get_exam_service, None)
        app.dependency_overrides.pop(get_exam_attempt_service, None)


def version_url(attempt_id, question_version_id, suffix=""):
    return f"{EXAM_URL}/{attempt_id}/responses/{question_version_id}{suffix}"


def test_owner_saves_an_answer(api):
    client, _, learner_id, attempt_id = api
    version_id = uuid4()
    response = client.put(
        version_url(attempt_id, version_id),
        json={"selected_option_ids": [str(uuid4())]},
        headers=auth(learner_id),
    )
    assert response.status_code == 200
    data = response.json()
    assert data["attempt_id"] == str(attempt_id)
    assert data["question_count"] == 2
    assert data["answered_count"] == 1
    assert data["unanswered_count"] == 1
    assert "is_correct" not in response.text


def test_clearing_an_answer_is_confirmed_with_counts(api):
    client, attempt_service, learner_id, attempt_id = api
    attempt_service.saved = []
    version_id = uuid4()
    response = client.put(
        version_url(attempt_id, version_id),
        json={"selected_option_ids": None, "text_response": None},
        headers=auth(learner_id),
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload.get("selected_option_ids") is None
    assert payload.get("text_response") is None


def test_foreign_and_unknown_attempts_are_indistinguishable(api):
    client, _, learner_id, attempt_id = api
    for target in (uuid4(),):
        response = client.put(
            version_url(target, uuid4()),
            json={"selected_option_ids": [str(uuid4())]},
            headers=auth(learner_id),
        )
        assert response.status_code == 404
        assert response.json()["detail"] == "Exam attempt not found"


def test_missing_or_malformed_auth_is_rejected(api):
    client, _, _, attempt_id = api
    response = client.put(
        version_url(attempt_id, uuid4()),
        json={"selected_option_ids": [str(uuid4())]},
    )
    assert response.status_code == 401


def test_saving_after_final_submission_is_rejected(api):
    client, attempt_service, learner_id, attempt_id = api
    attempt_service.error = AttemptAlreadySubmittedError("already")
    response = client.put(
        version_url(attempt_id, uuid4()),
        json={"selected_option_ids": [str(uuid4())]},
        headers=auth(learner_id),
    )
    assert response.status_code == 409


def test_saving_a_locked_question_is_rejected(api):
    client, attempt_service, learner_id, attempt_id = api
    attempt_service.error = QuestionAlreadyLockedError("locked")
    response = client.put(
        version_url(attempt_id, uuid4()),
        json={"selected_option_ids": [str(uuid4())]},
        headers=auth(learner_id),
    )
    assert response.status_code == 409


def test_invalid_selections_are_rejected(api):
    client, attempt_service, learner_id, attempt_id = api
    attempt_service.error = InvalidResponseContentError("bad")
    response = client.put(
        version_url(attempt_id, uuid4()),
        json={"selected_option_ids": [str(uuid4())]},
        headers=auth(learner_id),
    )
    assert response.status_code == 422


def test_question_not_in_attempt_not_leaks_existence(api):
    client, attempt_service, learner_id, attempt_id = api
    attempt_service.error = AttemptQuestionNotFoundError("nope")
    response = client.put(
        version_url(attempt_id, uuid4()),
        json={"selected_option_ids": [str(uuid4())]},
        headers=auth(learner_id),
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Exam attempt not found"


def test_progress_locks_at_bounds(api):
    client, attempt_service, learner_id, attempt_id = api
    response = client.patch(
        f"{EXAM_URL}/{attempt_id}/progress",
        json={"current_position": 2},
        headers=auth(learner_id),
    )
    assert response.status_code == 200
    assert response.json()["current_position"] == 2

    attempt_service.error = InvalidResponseContentError("out of range")
    response = client.patch(
        f"{EXAM_URL}/{attempt_id}/progress",
        json={"current_position": 99},
        headers=auth(learner_id),
    )
    assert response.status_code == 422


def test_progress_after_final_submission_is_rejected(api):
    client, attempt_service, learner_id, attempt_id = api
    attempt_service.error = AttemptAlreadySubmittedError("already")
    response = client.patch(
        f"{EXAM_URL}/{attempt_id}/progress",
        json={"current_position": 1},
        headers=auth(learner_id),
    )
    assert response.status_code == 409


def test_deferred_mode_withholds_all_feedback(api):
    client, attempt_service, learner_id, attempt_id = api
    response = client.post(
        version_url(attempt_id, uuid4(), "/submit"),
        json={"selected_option_ids": [str(uuid4())]},
        headers=auth(learner_id),
    )
    assert response.status_code == 200
    data = response.json()
    assert data["feedback_released"] is False
    assert data.get("is_correct") is None
    assert "is_correct" not in response.text
    assert "correct_option_ids" not in response.text
    assert "explanation" not in response.text


def test_immediate_mode_releases_verdict_and_correct_ids(api):
    client, attempt_service, learner_id, attempt_id = api
    correct_id = uuid4()
    attempt_service.questions_submitted = []

    def immediate(attempt, question_version_id, **kwargs):
        attempt_service.questions_submitted.append(question_version_id)
        return {
            "question_submitted_at": datetime.now(UTC),
            "feedback_released": True,
            "is_correct": False,
            "correct_option_ids": [correct_id],
            "explanation": "Not quite.",
        }

    attempt_service.submit_question = immediate
    response = client.post(
        version_url(attempt_id, uuid4(), "/submit"),
        json={"selected_option_ids": [str(uuid4())]},
        headers=auth(learner_id),
    )
    assert response.status_code == 200
    data = response.json()
    assert data["feedback_released"] is True
    assert data["is_correct"] is False
    assert UUID(data["correct_option_ids"][0]) == correct_id
    assert data["explanation"] == "Not quite."


def test_empty_question_submit_is_rejected(api):
    client, attempt_service, learner_id, attempt_id = api
    attempt_service.error = NoAnswerContentError("Cannot submit an empty answer")
    response = client.post(
        version_url(attempt_id, uuid4(), "/submit"),
        json={"selected_option_ids": None, "text_response": None},
        headers=auth(learner_id),
    )
    assert response.status_code == 422


def test_final_submission_confirms_and_links_results(api):
    client, attempt_service, learner_id, attempt_id = api
    response = client.post(f"{EXAM_URL}/{attempt_id}/submit", headers=auth(learner_id))
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "submitted"
    assert data["results_url"] == f"/api/v1/exams/{attempt_id}/results"
    assert attempt_service.submitted is True


def test_duplicate_final_submission_returns_conflict(api):
    client, attempt_service, learner_id, attempt_id = api
    attempt_service.error = AttemptAlreadySubmittedError("already")
    response = client.post(f"{EXAM_URL}/{attempt_id}/submit", headers=auth(learner_id))
    assert response.status_code == 409
    assert attempt_service.submitted is False


def test_results_before_submission_are_refused(api):
    client, attempt_service, learner_id, attempt_id = api
    attempt_service.error = AttemptNotSubmittedError("not submitted")
    response = client.get(f"{EXAM_URL}/{attempt_id}/results", headers=auth(learner_id))
    assert response.status_code == 409


def test_results_never_disclose_answer_keys(api):
    client, attempt_service, learner_id, attempt_id = api
    response = client.get(f"{EXAM_URL}/{attempt_id}/results", headers=auth(learner_id))
    assert response.status_code == 200
    data = response.json()
    assert data["score_percent"] == 50.0
    assert data["passed"] is False
    assert data["score_basis"] == "graded_questions_only"
    assert data["grading_complete"] is True
    for forbidden in ("correct_option_ids", "expected_answer", "explanation"):
        assert forbidden not in response.text


def test_zero_gradable_attempt_has_no_misleading_score(api):
    client, attempt_service, learner_id, attempt_id = api

    def zero_gradable(attempt):
        payload = dict(StubAttemptService().results_payload(attempt))
        payload.update(
            {
                "points_possible": 0,
                "points_earned": 0,
                "score_percent": None,
                "passed": None,
                "ungradable_count": 2,
                "graded_count": 0,
            }
        )
        return payload

    attempt_service.results_payload = zero_gradable
    response = client.get(f"{EXAM_URL}/{attempt_id}/results", headers=auth(learner_id))
    assert response.status_code == 200
    data = response.json()
    assert data["score_percent"] is None
    assert data["passed"] is None
    assert data["grading_complete"] is True
