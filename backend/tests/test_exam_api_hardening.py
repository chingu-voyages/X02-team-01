"""JHEP-29: hostile inputs, authentication, and learner-response safety.

These API tests use a stub service. They do not require PostgreSQL.
"""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import jwt
import pytest
from fastapi.testclient import TestClient

from app.api.v1.endpoints.exams import get_exam_service
from app.core.config import settings
from app.core.security import create_access_token
from app.main import app
from app.services.exam_service import (
    CreatedExam,
    ExamOptionContent,
    ExamQuestionContent,
)

EXAMS_URL = "/api/v1/exams"


class HardeningExamService:
    """Capture incoming calls; return only learner-visible data."""

    def __init__(self) -> None:
        self.calls: list[tuple[UUID, UUID, int]] = []
        self.deliveries: list[UUID] = []
        self.attempt_id = uuid4()
        self.version_id = uuid4()
        self.option_id = uuid4()
        self.question_text = "Quel événement? ∑ √π 🇫🇷"
        self.option_text = "A: Résumé"
        self.fail_with: Exception | None = None

    def create_exam(
        self, *, learner_id: UUID, certification_id: UUID, question_count: int
    ) -> CreatedExam:
        self.calls.append((learner_id, certification_id, question_count))
        if self.fail_with is not None:
            raise self.fail_with
        return CreatedExam(self.attempt_id, certification_id, question_count)

    def get_exam_questions(self, attempt_id: UUID) -> list[ExamQuestionContent]:
        self.deliveries.append(attempt_id)
        return [
            ExamQuestionContent(
                id=self.version_id,
                position=1,
                question_text=self.question_text,
                question_type="multiple_choice",
                allows_multiple_answers=False,
                difficulty="easy",
                options=[
                    ExamOptionContent(
                        id=self.option_id,
                        position=1,
                        option_text=self.option_text,
                    )
                ],
            )
        ]


@pytest.fixture
def api_client():
    """Ensure dependency overrides are removed after each test."""
    stub = HardeningExamService()
    learner_id, cert_id = uuid4(), uuid4()
    app.dependency_overrides[get_exam_service] = lambda: stub
    try:
        with TestClient(app) as client:
            yield client, stub, learner_id, cert_id
    finally:
        app.dependency_overrides.pop(get_exam_service, None)


def auth(learner_id: UUID | str) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(str(learner_id))}"}


def exam_payload(cert_id: UUID, count: int = 1) -> dict[str, str | int]:
    return {"certification_id": str(cert_id), "question_count": count}


@pytest.mark.parametrize(
    "bad_count",
    [0, -1, -100, 101, 10**50, True, False, 1.25, "1", None, [], {}],
)
def test_rejects_invalid_counts_without_creating_exam(api_client, bad_count):
    client, stub, learner, cert = api_client
    data = {**exam_payload(cert), "question_count": bad_count}
    response = client.post(EXAMS_URL, json=data, headers=auth(learner))
    assert response.status_code == 422
    assert stub.calls == []
    assert stub.deliveries == []


@pytest.mark.parametrize("bad_id", ["", "not-a-uuid", None, 37, "💥"])
def test_rejects_invalid_certification_identifiers(api_client, bad_id):
    client, stub, learner, cert = api_client
    data = {**exam_payload(cert), "certification_id": bad_id}
    response = client.post(EXAMS_URL, json=data, headers=auth(learner))
    assert response.status_code == 422
    assert stub.calls == []


@pytest.mark.parametrize(
    "unexpected_field",
    ["learner_id", "user_id", "status", "is_correct", "expected_answer"],
)
def test_rejects_client_controlled_internal_fields(api_client, unexpected_field):
    client, stub, learner, cert = api_client
    data = {**exam_payload(cert), unexpected_field: str(uuid4())}
    response = client.post(EXAMS_URL, json=data, headers=auth(learner))
    assert response.status_code == 422
    assert stub.calls == []


@pytest.mark.parametrize("missing", ["certification_id", "question_count"])
def test_rejects_missing_required_fields(api_client, missing):
    client, stub, learner, cert = api_client
    data = exam_payload(cert)
    del data[missing]
    response = client.post(EXAMS_URL, json=data, headers=auth(learner))
    assert response.status_code == 422
    assert stub.calls == []


def test_rejects_malformed_json(api_client):
    client, stub, learner, _ = api_client
    response = client.post(
        EXAMS_URL,
        content=b'{"certification_id":',
        headers={**auth(learner), "Content-Type": "application/json"},
    )
    assert response.status_code == 422
    assert stub.calls == []


@pytest.mark.parametrize(
    "authorization", [None, "Bearer", "Bearer invalid", "Basic abc"]
)
def test_missing_or_invalid_authorization_never_calls_service(
    api_client, authorization
):
    client, stub, _, cert = api_client
    headers = {} if authorization is None else {"Authorization": authorization}
    response = client.post(EXAMS_URL, json=exam_payload(cert), headers=headers)
    assert response.status_code == 401
    assert stub.calls == []
    assert stub.deliveries == []


def test_rejects_token_signed_with_wrong_secret(api_client):
    client, stub, learner, cert = api_client
    now = datetime.now(UTC)
    forged = jwt.encode(
        {"sub": str(learner), "iat": now, "exp": now + timedelta(hours=1)},
        "wrong-secret-for-unit-test-only",
        algorithm="HS256",
    )
    response = client.post(
        EXAMS_URL,
        json=exam_payload(cert),
        headers={"Authorization": f"Bearer {forged}"},
    )
    assert response.status_code == 401
    assert stub.calls == []


def test_rejects_expired_token(api_client):
    client, stub, learner, cert = api_client
    now = datetime.now(UTC)
    expired = jwt.encode(
        {
            "sub": str(learner),
            "iat": now - timedelta(hours=2),
            "exp": now - timedelta(minutes=1),
        },
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )
    response = client.post(
        EXAMS_URL,
        json=exam_payload(cert),
        headers={"Authorization": f"Bearer {expired}"},
    )
    assert response.status_code == 401
    assert stub.calls == []


def test_rejects_non_uuid_but_correctly_signed_subject(api_client):
    client, stub, _, cert = api_client
    response = client.post(
        EXAMS_URL,
        json=exam_payload(cert),
        headers=auth("legacy-user-name"),
    )
    assert response.status_code == 401
    assert stub.calls == []


@pytest.mark.parametrize(
    "question_text",
    [
        "Français: où est l'équipe? Éléphant, naïve, résumé",
        "Español: ¿Qué significa acción? ¡Sí!",
        "日本語 中文 한국어: 漢字と文字",
        "العربية: مرحبا بالعالم — עברית: שלום",
        "Math: ∫₀¹ x² dx = ⅓; Σ, √, π, ≤, ≥, x^2, \\(\\frac{a}{b}\\)",
        "Emoji 👩🏽‍💻 🔐 🎯 and combining e\u0301, zero-width \u200b",
        "Quotes: ' \" <script>alert(1)</script> & \n second line",
        "Long UTF-8 text: " + "rôle—Δx²😊 " * 2000,
    ],
)
def test_question_content_is_preserved_and_response_is_allowlisted(
    api_client, question_text
):
    client, stub, learner, cert = api_client
    stub.question_text = question_text
    response = client.post(EXAMS_URL, json=exam_payload(cert), headers=auth(learner))
    assert response.status_code == 201
    body = response.json()
    assert body["question_count"] == 1
    assert len(body["questions"]) == 1
    question = body["questions"][0]
    assert question["question_text"] == question_text
    assert set(question) == {
        "id",
        "position",
        "question_text",
        "question_type",
        "allows_multiple_answers",
        "difficulty",
        "options",
        "images",
    }
    assert question["images"] == []
    assert set(question["options"][0]) == {"id", "position", "option_text"}
    assert stub.calls == [(learner, cert, 1)]
    assert stub.deliveries == [stub.attempt_id]


def test_internal_exception_does_not_expose_private_message(api_client):
    """Default production FastAPI error responses should not reveal internals."""
    _, stub, learner, cert = api_client
    stub.fail_with = RuntimeError("private database detail: expected_answer=SECRET")
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            EXAMS_URL, json=exam_payload(cert), headers=auth(learner)
        )
    assert response.status_code == 500
    assert "SECRET" not in response.text
    assert stub.deliveries == []
