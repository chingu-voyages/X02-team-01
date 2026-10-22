from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.api.v1.endpoints.questions import get_question_repository
from app.core.security import create_access_token
from app.main import app
from app.repositories.in_memory import InMemoryQuestionRepository
from app.repositories.question_repository import Question

QUESTIONS_URL = "/api/v1/questions"


def auth_header() -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token('test-learner')}"}


@pytest.fixture
def empty_client() -> Iterator[TestClient]:
    """A client whose repository holds no questions at all."""

    def _empty() -> InMemoryQuestionRepository:
        return InMemoryQuestionRepository(questions=[])

    app.dependency_overrides[get_question_repository] = _empty

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()


def test_requires_authentication(client: TestClient) -> None:
    response = client.get(QUESTIONS_URL)

    assert response.status_code == 401


def test_rejects_invalid_token(client: TestClient) -> None:
    response = client.get(
        QUESTIONS_URL,
        headers={"Authorization": "Bearer not-a-real-token"},
    )

    assert response.status_code == 401


def test_only_eligible_questions_are_returned(client: TestClient) -> None:
    response = client.get(QUESTIONS_URL, headers=auth_header())

    assert response.status_code == 200

    returned = {item["id"] for item in response.json()["items"]}

    # approved + active + unflagged, one of each question type
    assert returned == {"v-1004", "v-1005"}


def test_pending_question_is_excluded(client: TestClient) -> None:
    response = client.get(QUESTIONS_URL, headers=auth_header())

    returned = {item["id"] for item in response.json()["items"]}

    assert "v-1008" not in returned  # pending


def test_rejected_question_is_excluded(client: TestClient) -> None:
    response = client.get(QUESTIONS_URL, headers=auth_header())

    returned = {item["id"] for item in response.json()["items"]}

    assert "v-1009" not in returned  # rejected


def test_retired_question_is_excluded(client: TestClient) -> None:
    response = client.get(QUESTIONS_URL, headers=auth_header())

    returned = {item["id"] for item in response.json()["items"]}

    assert "v-1007" not in returned  # retired


def test_draft_question_is_excluded(client: TestClient) -> None:
    response = client.get(QUESTIONS_URL, headers=auth_header())

    returned = {item["id"] for item in response.json()["items"]}

    assert "v-1006" not in returned  # approved but unpublished


def test_flagged_question_is_excluded(client: TestClient) -> None:
    response = client.get(QUESTIONS_URL, headers=auth_header())

    returned = {item["id"] for item in response.json()["items"]}

    assert "v-1010" not in returned  # approved + active but flagged


def test_response_never_leaks_answer_keys(client: TestClient) -> None:
    response = client.get(QUESTIONS_URL, headers=auth_header())

    body = response.text

    assert "is_correct" not in body
    assert "expected_answer" not in body
    assert "correct" not in body.lower()

    for item in response.json()["items"]:
        assert set(item) == {
            "id",
            "question_text",
            "question_type",
            "difficulty",
            "options",
        }
        for option in item["options"]:
            assert set(option) == {"position", "option_text"}


def test_count_matches_items(client: TestClient) -> None:
    payload = client.get(QUESTIONS_URL, headers=auth_header()).json()

    assert payload["count"] == len(payload["items"])


def test_empty_state_returns_clear_payload(empty_client: TestClient) -> None:
    response = empty_client.get(QUESTIONS_URL, headers=auth_header())

    assert response.status_code == 200
    assert response.json() == {"items": [], "count": 0}


def test_short_answer_has_no_options(client: TestClient) -> None:
    items = client.get(QUESTIONS_URL, headers=auth_header()).json()["items"]

    short_answer = next(i for i in items if i["question_type"] == "short_answer")

    assert short_answer["options"] == []


def test_repository_contract_is_structural() -> None:
    """Any object with a matching list_eligible method satisfies the protocol."""
    bank = InMemoryQuestionRepository().list_eligible()

    assert isinstance(bank, list)
    assert all(isinstance(q, Question) for q in bank)
