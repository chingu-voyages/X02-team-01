from datetime import UTC, datetime, timedelta
from typing import Annotated

import jwt
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.api.deps import get_current_subject
from app.core.config import settings
from app.core.security import create_access_token

# Test-only FastAPI application
app = FastAPI()


@app.get("/protected")
def protected(
    subject: Annotated[str, Depends(get_current_subject)],
) -> dict[str, str]:
    return {"sub": subject}


client = TestClient(app)


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_valid_token():
    token = create_access_token("test-user-123")

    response = client.get(
        "/protected",
        headers=auth_header(token),
    )

    assert response.status_code == 200
    assert response.json() == {"sub": "test-user-123"}


def test_missing_token():
    response = client.get("/protected")

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


def test_invalid_token():
    response = client.get(
        "/protected",
        headers=auth_header("invalid-token"),
    )

    assert response.status_code == 401


def test_expired_token():
    now = datetime.now(UTC)

    token = jwt.encode(
        {
            "sub": "test-user-123",
            "iat": now - timedelta(minutes=10),
            "exp": now - timedelta(minutes=1),
        },
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )

    response = client.get(
        "/protected",
        headers=auth_header(token),
    )

    assert response.status_code == 401


def test_tampered_token():
    token = create_access_token("test-user-123")
    header, payload, signature = token.split(".")

    replacement = "A" if signature[0] != "A" else "B"
    tampered = f"{header}.{payload}.{replacement}{signature[1:]}"

    response = client.get(
        "/protected",
        headers=auth_header(tampered),
    )

    assert response.status_code == 401


def test_missing_subject():
    now = datetime.now(UTC)

    token = jwt.encode(
        {
            "iat": now,
            "exp": now + timedelta(minutes=5),
        },
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )

    response = client.get(
        "/protected",
        headers=auth_header(token),
    )

    assert response.status_code == 401


def test_wrong_authentication_scheme():
    response = client.get(
        "/protected",
        headers={"Authorization": "Basic abc123"},
    )

    assert response.status_code == 401
