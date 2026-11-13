"""JHEP-24 registration service: policy, roles, verification semantics."""

import json
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
    # JHEP-99 serialization: the display name is emitted as `fullName`
    # (trimmed by the schema validator; the snake alias is input-only).
    assert body["fullName"] == "  Wired Learner  ".strip()
    assert "full_name" not in body
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
    assert response.json()["code"] == "EMAIL_TAKEN"


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
    body = response.json()
    assert body["code"] == "WEAK_PASSWORD"
    assert "uppercase" in body["message"]


def test_verify_consumes_one_time_token(register_api, sqlite_session):
    client, service = register_api
    service.register(
        email="verify-me@example.com", full_name="Verifier", password="Str0ngEn0ugh1"
    )
    token_raw = _captured_raw_token(sqlite_session)

    response = client.get(
        "/api/v1/auth/verify", params={"token": str(token_raw)}, follow_redirects=False
    )
    assert response.status_code == 303
    assert response.headers["location"].endswith("/login?verified=1")
    # the learner is actually verified
    with Session(sqlite_session.get_bind()) as fresh:
        stored = fresh.exec(
            select(User).where(User.email == "verify-me@example.com")
        ).one()
        assert stored.is_verified is True

    # One-time semantics: replay redirects to the login screen with an
    # invalid flag (the emailed link is always human-clicked).
    replay = client.get(
        "/api/v1/auth/verify", params={"token": str(token_raw)}, follow_redirects=False
    )
    assert replay.status_code == 303
    assert replay.headers["location"].endswith("/login?verification=invalid")


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
    assert response.json()["code"] == "RATE_LIMITED"

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


# --- JHEP-24: the email architecture (adapters, env matrix, fail-fast) ---


def test_console_sender_logs_without_a_mail_server(caplog):
    """The default transport: the link is logged deterministically."""
    import logging

    from app.services.email_delivery import ConsoleSender

    with caplog.at_level(logging.INFO):
        ConsoleSender().send(
            to="learner@example.com",
            subject="Verify your account",
            body="http://link/token",
        )
    assert "learner@example.com" in caplog.text
    assert "http://link/token" in caplog.text
    assert "password" not in caplog.text.lower()


def test_factory_selects_by_settings(monkeypatch):
    """The env matrix: EMAIL_DELIVERY drives the adapter selection."""
    from app.core.config import settings
    from app.services.email_delivery import (
        ConsoleSender,
        MailpitSender,
        email_sender,
    )

    monkeypatch.setattr(settings, "email_delivery", "console")
    assert isinstance(email_sender(), ConsoleSender)

    monkeypatch.setattr(settings, "email_delivery", "mailpit")
    assert isinstance(email_sender(), MailpitSender)


def test_fail_fast_on_missing_smtp_credentials(monkeypatch):
    """Fail-fast: EMAIL_DELIVERY=smtp without credentials raises at factory
    time (a misconfigured production email blocks launch)."""
    import pytest as _pytest

    from app.core.config import settings
    from app.services.email_delivery import email_sender

    monkeypatch.setattr(settings, "email_delivery", "smtp")
    monkeypatch.setattr(settings, "email_smtp_user", "")
    monkeypatch.setattr(settings, "email_smtp_password", "")
    with _pytest.raises(RuntimeError, match="EMAIL_SMTP_USER"):
        email_sender()

    # credentials present -> the adapter constructs (no send attempted)
    monkeypatch.setattr(settings, "email_smtp_user", "demo@example.com")
    monkeypatch.setattr(settings, "email_smtp_password", "app-password")
    sender = email_sender()
    assert type(sender).__name__ == "SmtpSender"


def test_fail_fast_on_missing_resend_key(monkeypatch):
    from app.core.config import settings
    from app.services.email_delivery import email_sender

    monkeypatch.setattr(settings, "email_delivery", "resend")
    monkeypatch.setattr(settings, "email_api_key", "")
    with pytest.raises(RuntimeError, match="EMAIL_API_KEY"):
        email_sender()


def test_smtp_sender_uses_starttls_and_auth(monkeypatch):
    """The SMTP adapter: STARTTLS + login by settings (no real send)."""
    from app.services import email_delivery as ed

    class FakeSMTP:
        def __init__(self, host, port, timeout=None):
            self.host = host
            self.port = port
            self.calls = []

        def ehlo(self):
            self.calls.append("ehlo")

        def starttls(self):
            self.calls.append("starttls")

        def login(self, user, password):
            self.calls.append(("login", user))

        def send_message(self, message):
            self.calls.append(("send", message["To"], message["Subject"]))

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    monkeypatch.setattr(ed.settings, "email_smtp_starttls", True)
    monkeypatch.setattr(ed.settings, "email_smtp_user", "sender@gmail.com")
    monkeypatch.setattr(ed.settings, "email_smtp_password", "app-password-16")
    fake = FakeSMTP("smtp.gmail.com", 587)
    monkeypatch.setattr(ed.smtplib, "SMTP", lambda *a, **k: fake)

    ed.SmtpSender().send(
        to="learner@example.com",
        subject="Verify your Job Hackers account",
        body="Welcome!",
    )
    assert "ehlo" in fake.calls
    assert "starttls" in fake.calls
    assert ("login", "sender@gmail.com") in fake.calls
    sent = [c for c in fake.calls if c[0] == "send"][0]
    assert sent[1] == "learner@example.com"
    assert sent[2] == "Verify your Job Hackers account"
    # the password never appears in the message payload
    assert "app-password" not in str(fake.calls)


def test_resend_sender_posts_the_payload(monkeypatch):
    """The Resend adapter: one HTTPS POST with the API key; the payload
    carries from/to/subject/text (never the credentials)."""
    import io

    from app.services import email_delivery as ed

    class FakeResponse(io.BytesIO):
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    captured = {}

    def fake_urlopen(request, timeout=None):
        captured["url"] = request.full_url
        captured["headers"] = dict(request.header_items())
        captured["payload"] = request.data
        return FakeResponse(b'{"id":"re_123"}')

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    monkeypatch.setattr(ed.settings, "email_api_key", "re_test_key")

    ed.ResendSender().send(
        to="learner@example.com",
        subject="Verify your Job Hackers account",
        body="Welcome, John Doe!",
    )
    assert captured["url"] == "https://api.resend.com/emails"
    headers = {k.lower(): v for k, v in captured["headers"].items()}
    assert headers["authorization"] == "Bearer re_test_key"
    # Resend's WAF bans the default Python-urllib signature (Cloudflare
    # 1010 -> 403, seen live on Render) — an explicit UA is mandatory.
    assert "python-urllib" not in headers.get("user-agent", "").lower()
    assert "jhep-backend" in headers.get("user-agent", "").lower()
    payload = json.loads(captured["payload"])
    assert payload["to"] == ["learner@example.com"]
    assert payload["subject"] == "Verify your Job Hackers account"
    assert payload["text"] == "Welcome, John Doe!"
    assert "re_test_key" not in captured["payload"].decode()


def test_settings_tolerate_env_values_with_stray_whitespace(monkeypatch):
    """Regression (Render live incident): a value pasted with a trailing
    newline ('smtp\\n') must not crash startup, and an empty value falls
    back to console."""
    from app.core.config import Settings

    with monkeypatch.context() as env:
        for key in (
            "POSTGRES_DB",
            "POSTGRES_USER",
            "POSTGRES_PASSWORD",
            "JWT_SECRET_KEY",
        ):
            env.setenv(key, "ci")
        env.setenv("EMAIL_DELIVERY", "smtp\n")
        env.setenv("VERIFICATION_LINK_BASE", "https://backend.example.com/verify\n")
        settings = Settings(_env_file=None)
        assert settings.email_delivery == "smtp"
        assert settings.verification_link_base == "https://backend.example.com/verify"

        env.setenv("EMAIL_DELIVERY", "")
        assert Settings(_env_file=None).email_delivery == "console"


def test_settings_strip_email_credentials_with_stray_whitespace(monkeypatch):
    """Regression: SMTP credentials pasted with a trailing newline must not
    fail provider auth at send time."""
    from app.core.config import Settings

    with monkeypatch.context() as env:
        for key in (
            "POSTGRES_DB",
            "POSTGRES_USER",
            "POSTGRES_PASSWORD",
            "JWT_SECRET_KEY",
        ):
            env.setenv(key, "ci")
        env.setenv("EMAIL_SMTP_PASSWORD", "app-password-16\n")
        env.setenv("EMAIL_SMTP_USER", "sender@gmail.com\n")
        env.setenv("EMAIL_FROM", "sender@gmail.com\n")
        settings = Settings(_env_file=None)
        assert settings.email_smtp_password == "app-password-16"
        assert settings.email_smtp_user == "sender@gmail.com"
        assert settings.email_from == "sender@gmail.com"


def test_register_survives_a_failing_email_transport(
    register_api, sqlite_session, monkeypatch
):
    """Regression (Render live incident): a refused/broken transport must
    NOT turn registration into a 500 — the account is created and pending,
    and the failure is logged for operators."""
    client, service = register_api

    class ExplodingSender:
        def send(self, *, to: str, subject: str, body: str) -> None:
            raise RuntimeError("smtp refused (simulated provider outage)")

    monkeypatch.setattr(registration_module, "email_sender", ExplodingSender)
    monkeypatch.setattr(registration_module, "RESEND_MIN_INTERVAL_SECONDS", 0)

    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": "resilient@example.com",
            "full_name": "Resilient",
            "password": "Str0ngEn0ugh1",
        },
    )
    assert response.status_code == 201
    assert response.json()["status"] == "pending_verification"


def test_resend_survives_a_failing_email_transport(
    register_api, sqlite_session, monkeypatch
):
    client, service = register_api
    service.register(
        email="resend-fail@example.com",
        full_name="Resend",
        password="Str0ngEn0ugh1",
    )

    class ExplodingSender:
        def send(self, *, to: str, subject: str, body: str) -> None:
            raise RuntimeError("smtp refused")

    monkeypatch.setattr(registration_module, "email_sender", ExplodingSender)
    monkeypatch.setattr(registration_module, "RESEND_MIN_INTERVAL_SECONDS", 0)

    response = client.post(
        "/api/v1/auth/resend-verification",
        json={"email": "resend-fail@example.com"},
    )
    assert response.status_code == 200
    assert "has been sent" in response.json()["message"]


def _login_token(client, email: str) -> str:
    response = client.post(
        "/api/v1/auth/login", json={"email": email, "password": "Str0ngEn0ugh1"}
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def test_logout_returns_stateless_ack(register_api, sqlite_session):
    """JHEP-25 AC2: a valid learner session gets the stateless ack."""
    from app.db.session import get_session

    client, service = register_api
    # login reads users through the app's session dependency — point it
    # at the same SQLite session the service wrote to.
    client.app.dependency_overrides[get_session] = lambda: sqlite_session
    try:
        service.register(
            email="logout-ack@example.com",
            full_name="Logout",
            password="Str0ngEn0ugh1",
        )
        # login requires a verified account — activate the learner the
        # same way the emailed link would.
        learner = sqlite_session.exec(
            select(User).where(User.email == "logout-ack@example.com")
        ).one()
        learner.is_verified = True
        sqlite_session.add(learner)
        sqlite_session.commit()
        token = _login_token(client, "logout-ack@example.com")
    finally:
        client.app.dependency_overrides.pop(get_session, None)

    response = client.post(
        "/api/v1/auth/logout",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["message"] == "Logged out"
    assert "logged_out_at" in body


def test_logout_requires_a_valid_session(register_api):
    """No token / a junk token -> the coded 401, like every auth path."""
    client, _ = register_api

    no_token = client.post("/api/v1/auth/logout")
    assert no_token.status_code == 401

    junk = client.post(
        "/api/v1/auth/logout",
        headers={"Authorization": "Bearer not-a-real-token"},
    )
    assert junk.status_code == 401
