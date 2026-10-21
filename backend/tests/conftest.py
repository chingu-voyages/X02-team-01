from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client() -> Iterator[TestClient]:
    """A TestClient bound to the FastAPI app, with lifespan handled."""
    with TestClient(app) as test_client:
        yield test_client
