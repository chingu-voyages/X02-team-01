from collections.abc import Iterator

import pytest
from admin_auth_fixtures import TEST_MFA_KEY
from fastapi.testclient import TestClient
from learner_auth_fixtures import stub_learner_database  # noqa: F401

from app.main import app


@pytest.fixture
def client() -> Iterator[TestClient]:
    """A TestClient bound to the FastAPI app, with lifespan handled."""
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def isolated_mfa_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    """Configure a test encryption key; production MFA rules remain active."""
    from app.services import mfa_service

    monkeypatch.setattr(mfa_service.settings, "mfa_encryption_key", TEST_MFA_KEY)
