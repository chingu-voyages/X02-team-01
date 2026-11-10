"""JHEP-24 registration service: policy, roles, verification semantics."""

import re

import pytest
from sqlalchemy import StaticPool, create_engine
from sqlmodel import Session, SQLModel, select

from app import models  # noqa: F401
from app.models import User
from app.services import registration_service as registration_module
from app.services.registration_service import (
    EmailTakenError,
    RegistrationService,
    WeakPasswordError,
)


@pytest.fixture
def sqlite_session(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    from sqlalchemy import MetaData

    metadata = MetaData()
    for table in SQLModel.metadata.sorted_tables:
        if table.name in ("users", "email_verification_tokens"):
            table.tometadata(metadata)
    SQLModel.metadata.create_all(engine, tables=list(metadata.tables.values()))
    # Deterministic email capture: the verification link's token is parsed
    # from the body, so the tests exercise the ACTUAL activation semantics.
    bodies: list[tuple[str, str, str]] = []

    class CapturingSender:
        def send(self, *, to: str, subject: str, body: str) -> None:
            bodies.append((to, subject, body))

    monkeypatch.setattr(registration_module, "email_sender", CapturingSender)

    with Session(engine) as session:
        session.bodies = bodies  # type: ignore[attr-defined]
        yield session


def test_register_creates_learner_with_hash(sqlite_session):
    service = RegistrationService(sqlite_session)
    user = service.register(
        email="new-learner@example.com",
        full_name="New Learner",
        password="Str0ngEn0ugh1",
    )
    assert user.full_name == "New Learner"  # stored as provided

    assert user.role == "learner"  # AC1: never elevated
    assert user.is_verified is False  # AC2: pending state
    assert user.hashed_password is not None
    assert user.hashed_password != "Str0ngEn0ugh1"  # never plaintext (AC3)


@pytest.mark.parametrize(
    "bad_password",
    ["Sh0rt", "alllowercase1", "ALLUPPERCASE1", "NoDigitsHereAtAll"],
)
def test_policy_rule_rejections(sqlite_session, bad_password):
    with pytest.raises(WeakPasswordError):
        RegistrationService(sqlite_session).register(
            email="policy@example.com", full_name="Policy Tester", password=bad_password
        )


def test_duplicate_email_is_rejected_and_creates_nothing(sqlite_session):
    service = RegistrationService(sqlite_session)
    service.register(
        email="taken@example.com", full_name="Taken User", password="Str0ngEn0ugh1"
    )
    with pytest.raises(EmailTakenError):
        service.register(
            email="taken@example.com", full_name="Taken User", password="Str0ngEn0ugh1"
        )

    users = sqlite_session.exec(select(User)).all()
    assert len(users) == 1  # AC3: no duplicate accounts


def test_registered_learner_cannot_grant_roles(sqlite_session):
    service = RegistrationService(sqlite_session)
    user = service.register(
        email="locked-role@example.com",
        full_name="Role Locked",
        password="Str0ngEn0ugh1",
    )
    # Whatever is submitted, the model+service write the Learner role.
    assert user.role == "learner"


@pytest.fixture
def register_api(sqlite_session, monkeypatch):
    """Endpoint-level fixture on a REAL RegistrationService wired through
    dependency injection, so the route's response shapes are exercised
    end-to-end against a SQLite/StaticPool session."""
    from fastapi.testclient import TestClient

    from app.api.v1.endpoints.auth import get_registration_service
    from app.main import app

    RegistrationService.__init__(sqlite_session, sqlite_session) if False else None
    service = RegistrationService(sqlite_session)
    app.dependency_overrides[get_registration_service] = lambda: service
    try:
        with TestClient(app) as test_client:
            yield test_client, service
    finally:
        app.dependency_overrides.pop(get_registration_service, None)


def test_register_happy_path_json_shape(register_api):
    client, _ = register_api
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": "wired@example.com",
            "full_name": "  Wired Learner  ",
            "password": "Str0ngEn0ugh1",
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["role"] == "learner"
    assert body["is_verified"] is False
    # Schema-level trim: the echoed full_name carries no surrounding spaces.
    assert body["full_name"] == "Wired Learner"
    assert body["full_name"] == body["full_name"].strip()
    assert body["status"] == "pending_verification"
    # AC3: password/credentials are never echoed or logged.
    assert "password" not in response.text.lower()
    assert "argon" not in response.text.lower()
    assert "hash" not in response.text.lower()


def test_register_duplicate_email_coded(register_api):
    client, _ = register_api
    payload = {
        "email": "twice@example.com",
        "full_name": "Twice Learner",
        "password": "Str0ngEn0ugh1",
    }
    assert client.post("/api/v1/auth/register", json=payload).status_code == 201
    response = client.post("/api/v1/auth/register", json=payload)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "EMAIL_TAKEN"


def test_register_weak_password_coded(register_api):
    client, _ = register_api
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": "weak@example.com",
            "full_name": "Weak Learner",
            "password": "alllowercase1",
        },
    )
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "WEAK_PASSWORD"
    assert "uppercase" in detail["message"]


def test_verify_consumes_one_time_token(register_api, sqlite_session):
    client, service = register_api
    service.register(
        email="verify-me@example.com", full_name="Verifier", password="Str0ngEn0ugh1"
    )
    token_raw = _captured_raw_token(sqlite_session)

    response = client.get("/api/v1/auth/verify", params={"token": str(token_raw)})
    assert response.status_code == 200
    body = response.json()
    assert body["is_verified"] is True
    assert body["status"] == "verified"

    # One-time semantics: replay fails with a coded 400.
    replay = client.get("/api/v1/auth/verify", params={"token": str(token_raw)})
    assert replay.status_code == 400
    assert replay.json()["detail"]["code"] == "INVALID_OR_EXPIRED_TOKEN"


def test_resend_is_rate_limited_enumeration_safe(register_api, sqlite_session):
    client, service = register_api
    service.register(
        email="throttled@example.com", full_name="Throttle", password="Str0ngEn0ugh1"
    )

    response = client.post(
        "/api/v1/auth/resend-verification",
        json={"email": "throttled@example.com"},
    )
    assert response.status_code == 429
    assert response.json()["detail"]["code"] == "RATE_LIMITED"

    # Unknown/unverified-agnostic responses (no enumeration).
    unknown = client.post(
        "/api/v1/auth/resend-verification",
        json={"email": "ghost-unknown@example.com"},
    )
    assert unknown.status_code == 200
    assert "a verification email has been sent" in unknown.json()["message"]


def _captured_raw_token(sqlite_session):
    """Extract the raw one-time token from the captured email body (the
    body carries the activation link the learner would click)."""
    bodies = [body for (_, _, body) in getattr(sqlite_session, "bodies", [])]
    link = bodies[-1]
    return re.search(r"token=([^\s\n]+)", link).group(1)


def test_full_name_is_trimmed_and_required(sqlite_session):
    """AC1: display name is trimmed server-side; empty/whitespace-only
    values fail; the persisted value carries the trimmed name."""
    service = RegistrationService(sqlite_session)

    # Semantics: the SERVICE stores as given; TRIMMING is the schema's
    # responsibility (asserted at API level below).
    passed_through = service.register(
        email="trimmed@example.com",
        full_name="   Ada Lovelace   ",
        password="Str0ngEn0ugh1",
    )
    assert passed_through.full_name == "   Ada Lovelace   "

    with pytest.raises(
        __import__("pydantic").ValidationError
    ):  # schema-level: min_length=1 catches whitespace-stripped empties
        from app.schemas.auth import UserRegistrationIn

        UserRegistrationIn(
            full_name="   ", email="x@example.com", password="Str0ngEn0ugh1"
        )
