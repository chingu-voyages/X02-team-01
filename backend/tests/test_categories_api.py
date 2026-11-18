"""JHEP-27 category catalog API contract and failure handling."""

from collections.abc import Iterator
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.api.v1.endpoints.categories import get_category_repository
from app.core.security import create_access_token
from app.main import app
from app.repositories.category_repository import AvailableCategory

CATEGORIES_URL = "/api/v1/categories"


class StubCategoryRepository:
    """Small API-test double; database filtering is covered separately."""

    def __init__(self, categories: list[AvailableCategory] | None = None) -> None:
        self.categories = categories or []
        self.calls: list[UUID | None] = []
        self.error: Exception | None = None

    def list_available(
        self,
        *,
        certification_id: UUID | None = None,
    ) -> list[AvailableCategory]:
        self.calls.append(certification_id)
        if self.error is not None:
            raise self.error
        return self.categories


def auth_header(subject: str = "test-learner") -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(subject)}"}


@pytest.fixture
def available_category() -> AvailableCategory:
    return AvailableCategory(
        id=uuid4(),
        certification_id=uuid4(),
        name="Révision — Agile ≥ 80%",
        certification_name="Agile Practice ✓",
        available_question_count=12,
    )


@pytest.fixture
def category_api(
    available_category: AvailableCategory,
) -> Iterator[tuple[TestClient, StubCategoryRepository, AvailableCategory]]:
    repository = StubCategoryRepository([available_category])
    app.dependency_overrides[get_category_repository] = lambda: repository

    with TestClient(app) as client:
        yield client, repository, available_category

    app.dependency_overrides.pop(get_category_repository, None)


def test_requires_authentication(category_api) -> None:
    client, repository, _ = category_api

    response = client.get(CATEGORIES_URL)

    assert response.status_code == 401
    assert repository.calls == []


def test_rejects_invalid_token(category_api) -> None:
    client, repository, _ = category_api

    response = client.get(
        CATEGORIES_URL,
        headers={"Authorization": "Bearer not-a-real-token"},
    )

    assert response.status_code == 401
    assert repository.calls == []


def test_returns_available_categories(category_api) -> None:
    client, repository, category = category_api

    response = client.get(CATEGORIES_URL, headers=auth_header())

    assert response.status_code == 200
    assert response.json() == {
        "categories": [
            {
                "id": str(category.id),
                "certification_id": str(category.certification_id),
                "name": "Révision — Agile ≥ 80%",
                "certification_name": "Agile Practice ✓",
                "available_question_count": 12,
            }
        ]
    }
    assert repository.calls == [None]


def test_response_contains_only_public_catalog_fields(category_api) -> None:
    client, _, _ = category_api

    response = client.get(CATEGORIES_URL, headers=auth_header())

    item = response.json()["categories"][0]
    assert set(item) == {
        "id",
        "certification_id",
        "name",
        "certification_name",
        "available_question_count",
    }
    assert "is_published" not in response.text
    assert "passing_threshold_pct" not in response.text
    assert "is_correct" not in response.text
    assert "expected_answer" not in response.text


def test_empty_catalog_is_successful(category_api) -> None:
    client, repository, _ = category_api
    repository.categories = []

    response = client.get(CATEGORIES_URL, headers=auth_header())

    assert response.status_code == 200
    assert response.json() == {"categories": []}


def test_certification_filter_is_forwarded(category_api) -> None:
    client, repository, category = category_api

    response = client.get(
        CATEGORIES_URL,
        params={"certification_id": str(category.certification_id)},
        headers=auth_header(),
    )

    assert response.status_code == 200
    assert repository.calls == [category.certification_id]


def test_invalid_certification_filter_is_rejected_before_repository(
    category_api,
) -> None:
    client, repository, _ = category_api

    response = client.get(
        CATEGORIES_URL,
        params={"certification_id": "not-a-uuid"},
        headers=auth_header(),
    )

    assert response.status_code == 422
    assert repository.calls == []


def test_database_failure_is_not_reported_as_empty_catalog(category_api) -> None:
    client, repository, _ = category_api
    repository.error = OperationalError(
        "SELECT categories",
        {},
        OSError("database unavailable"),
    )

    response = client.get(CATEGORIES_URL, headers=auth_header())

    assert response.status_code == 503
    assert response.json() == {
        "detail": "Practice exam categories are temporarily unavailable"
    }


def test_catalog_route_does_not_support_attempt_creation(category_api) -> None:
    client, repository, _ = category_api

    response = client.post(CATEGORIES_URL, json={}, headers=auth_header())

    assert response.status_code == 405
    assert repository.calls == []
