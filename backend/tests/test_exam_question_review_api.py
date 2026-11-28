"""JHEP-72 HTTP contract tests with dependency-isolated service results."""

from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.deps import get_authenticated_subject
from app.api.v1.endpoints.exam_question_review import (
    get_question_review_service,
    router,
)
from app.schemas.exam_question_review import CompletedQuestionReviewOut
from app.services.exam_question_review_service import HistoricalReviewUnavailableError
from app.services.exam_service import ExamAttemptNotFoundError
from app.services.grading_service import AttemptNotSubmittedError


@pytest.fixture
def api_case():
    attempt_id, version_id, learner_id = uuid4(), uuid4(), uuid4()
    payload = CompletedQuestionReviewOut(
        attempt_id=attempt_id,
        question_count=1,
        question_version_id=version_id,
        position=1,
        question_text="Original historical question",
        question_type="multiple_choice",
        allows_multiple_answers=False,
        question_status="unanswered",
        explanation="Original explanation",
    )
    service = SimpleNamespace(read=Mock(return_value=payload))
    app = FastAPI()
    app.include_router(router, prefix="/api/v1/exams")
    app.dependency_overrides[get_authenticated_subject] = lambda: str(learner_id)
    app.dependency_overrides[get_question_review_service] = lambda: service
    with TestClient(app) as client:
        yield SimpleNamespace(
            app=app,
            client=client,
            service=service,
            learner_id=learner_id,
            attempt_id=attempt_id,
            version_id=version_id,
            url=f"/api/v1/exams/{attempt_id}/review/questions/{version_id}",
        )


def test_owner_detail_is_uncached_and_passes_authenticated_identity(api_case):
    case = api_case
    response = case.client.get(case.url)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["question_version_id"] == str(case.version_id)
    assert response.json()["attempt_status"] == "submitted"
    case.service.read.assert_called_once_with(
        attempt_id=case.attempt_id,
        question_version_id=case.version_id,
        learner_id=case.learner_id,
    )


def test_missing_authentication_is_rejected_before_service(api_case):
    case = api_case
    del case.app.dependency_overrides[get_authenticated_subject]
    response = case.client.get(case.url)
    assert response.status_code == 401
    case.service.read.assert_not_called()


def test_invalid_authenticated_subject_does_not_read_detail(api_case):
    case = api_case
    case.app.dependency_overrides[get_authenticated_subject] = lambda: "invalid-subject"
    response = case.client.get(case.url)
    assert response.status_code == 401
    case.service.read.assert_not_called()


@pytest.mark.parametrize(
    "reason", ["unknown attempt", "foreign owner", "unassigned question"]
)
def test_not_found_does_not_disclose_which_identifier_exists(api_case, reason):
    case = api_case
    case.service.read.side_effect = ExamAttemptNotFoundError(reason)
    response = case.client.get(case.url)
    assert response.status_code == 404
    assert response.json() == {"detail": "Exam attempt not found"}
    assert response.headers["cache-control"] == "no-store"
    assert "explanation" not in response.text


def test_unfinished_attempt_returns_no_key_or_explanation(api_case):
    case = api_case
    case.service.read.side_effect = AttemptNotSubmittedError("secret internal context")
    response = case.client.get(case.url)
    assert response.status_code == 409
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {
        "detail": "Complete this exam before reviewing its questions."
    }
    assert "secret" not in response.text


def test_inconsistent_history_has_recoverable_non_disclosing_error(api_case):
    case = api_case
    case.service.read.side_effect = HistoricalReviewUnavailableError(
        "private identifiers"
    )
    response = case.client.get(case.url)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "QUESTION_REVIEW_UNAVAILABLE"
    assert response.headers["cache-control"] == "no-store"
    assert "private identifiers" not in response.text


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_review_has_no_mutation_method(api_case, method):
    response = api_case.client.request(method, api_case.url, json={"answer": "changed"})
    assert response.status_code == 405
    api_case.service.read.assert_not_called()


@pytest.mark.parametrize("which", ["attempt", "question"])
def test_malformed_path_identifiers_never_reach_service(api_case, which):
    case = api_case
    old = str(case.attempt_id if which == "attempt" else case.version_id)
    response = case.client.get(case.url.replace(old, "not-a-uuid"))
    assert response.status_code == 422
    case.service.read.assert_not_called()


@pytest.mark.filterwarnings("error:Duplicate Operation ID read_completed_question")
def test_detail_router_is_reachable_and_read_only_in_the_real_api(api_case):
    from app.api.v1.router import api_router

    # Include the actual application router, not just the isolated endpoint.
    # FastAPI >= 0.137 preserves nested routers instead of flattening routes.
    app = FastAPI()
    app.include_router(api_router, prefix="/api/v1")
    app.dependency_overrides.update(api_case.app.dependency_overrides)

    path = "/api/v1/exams/{attempt_id}/review/questions/{question_version_id}"
    operations = app.openapi()["paths"][path]
    assert set(operations) == {"get"}

    with TestClient(app) as client:
        response = client.get(api_case.url)
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert response.json()["question_version_id"] == str(api_case.version_id)
        assert response.json()["attempt_status"] == "submitted"

        for method in ("POST", "PUT", "PATCH", "DELETE"):
            rejected = client.request(method, api_case.url, json={"answer": "changed"})
            assert rejected.status_code == 405

    api_case.service.read.assert_called_once_with(
        attempt_id=api_case.attempt_id,
        question_version_id=api_case.version_id,
        learner_id=api_case.learner_id,
    )
