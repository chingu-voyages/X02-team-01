"""JHEP-29 FastAPI endpoint: auth, validation, response safety, error mapping."""

from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app.api.v1.endpoints.exams import get_exam_service
from app.core.security import create_access_token
from app.main import app
from app.services.exam_service import (
    CertificationNotFoundError,
    CreatedExam,
    ExamOptionContent,
    ExamQuestionContent,
    InsufficientQuestionsError,
    LearnerNotFoundError,
)

EXAMS_URL = "/api/v1/exams"


class StubExamService:
    """Simulate a successful exam without needing PostgreSQL for API tests."""

    def __init__(self):
        self.calls = []
        self.deliveries = []
        self.error = None
        self.attempt_id = uuid4()
        self.option_id = uuid4()
        self.question_version_id = uuid4()

    def create_exam(self, *, learner_id, certification_id, question_count):
        self.calls.append((learner_id, certification_id, question_count))
        if self.error is not None:
            raise self.error
        return CreatedExam(
            attempt_id=self.attempt_id,
            certification_id=certification_id,
            question_count=question_count,
        )

    def get_exam_questions(self, attempt_id):
        self.deliveries.append(attempt_id)
        return [
            ExamQuestionContent(
                id=self.question_version_id,
                position=1,
                question_text="Quel est le résultat de 2 + 2? ∑ π",
                question_type="multiple_choice",
                allows_multiple_answers=False,
                difficulty="easy",
                options=[
                    ExamOptionContent(
                        id=self.option_id,
                        position=1,
                        option_text="Quatre (4) ✓",
                    ),
                ],
            )
        ]


@pytest.fixture
def setup_api():
    stub = StubExamService()
    learner_id = uuid4()
    certification_id = uuid4()
    app.dependency_overrides[get_exam_service] = lambda: stub
    with TestClient(app) as client:
        yield client, stub, learner_id, certification_id
    app.dependency_overrides.pop(get_exam_service, None)


def headers(learner_id: UUID | str) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(str(learner_id))}"}


def payload(certification_id, question_count=1):
    return {"certification_id": str(certification_id), "question_count": question_count}


def test_creates_exam_returns_safe_questions(setup_api):
    client, stub, learner_id, certification_id = setup_api
    response = client.post(
        EXAMS_URL,
        json=payload(certification_id),
        headers=headers(learner_id),
    )
    assert response.status_code == 201
    body = response.json()
    assert UUID(body["attempt_id"]) == stub.attempt_id
    assert body["certification_id"] == str(certification_id)
    assert body["question_count"] == 1
    assert body["status"] == "in_progress"
    assert len(body["questions"]) == 1
    question = body["questions"][0]
    assert question["position"] == 1
    assert question["id"] == str(stub.question_version_id)
    assert question["question_text"] == "Quel est le résultat de 2 + 2? ∑ π"
    assert question["options"][0] == {
        "id": str(stub.option_id),
        "position": 1,
        "option_text": "Quatre (4) ✓",
    }
    assert "is_correct" not in response.text
    assert "expected_answer" not in response.text
    assert "review_status" not in response.text
    assert stub.calls == [(learner_id, certification_id, 1)]
    assert stub.deliveries == [stub.attempt_id]


def test_missing_token_is_unauthorized(setup_api):
    client, stub, _, certification_id = setup_api
    response = client.post(EXAMS_URL, json=payload(certification_id))
    assert response.status_code == 401
    assert stub.calls == []


def test_invalid_token_is_unauthorized(setup_api):
    client, stub, _, certification_id = setup_api
    response = client.post(
        EXAMS_URL,
        json=payload(certification_id),
        headers={"Authorization": "Bearer invalid"},
    )
    assert response.status_code == 401
    assert stub.calls == []


def test_non_uuid_jwt_subject_is_unauthorized(setup_api):
    client, stub, _, certification_id = setup_api
    response = client.post(
        EXAMS_URL,
        json=payload(certification_id),
        headers=headers("legacy-string-subject"),
    )
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert stub.calls == []


@pytest.mark.parametrize("invalid_count", [0, -1, 101, True, 2.5, "3", None])
def test_rejects_invalid_question_count(setup_api, invalid_count):
    client, stub, learner_id, certification_id = setup_api
    response = client.post(
        EXAMS_URL,
        json=payload(certification_id, invalid_count),
        headers=headers(learner_id),
    )
    assert response.status_code == 422
    assert stub.calls == []


def test_rejects_invalid_certification_uuid(setup_api):
    client, stub, learner_id, _ = setup_api
    response = client.post(
        EXAMS_URL,
        json={"certification_id": "not-a-uuid", "question_count": 1},
        headers=headers(learner_id),
    )
    assert response.status_code == 422
    assert stub.calls == []


def test_cannot_override_authenticated_user(setup_api):
    client, stub, learner_id, certification_id = setup_api
    data = payload(certification_id)
    data["learner_id"] = str(uuid4())
    response = client.post(EXAMS_URL, json=data, headers=headers(learner_id))
    assert response.status_code == 422
    assert stub.calls == []


def test_unknown_learner_returns_401(setup_api):
    client, stub, learner_id, certification_id = setup_api
    stub.error = LearnerNotFoundError("Learner not found")
    response = client.post(
        EXAMS_URL, json=payload(certification_id), headers=headers(learner_id)
    )
    assert response.status_code == 401
    assert stub.deliveries == []


def test_unknown_certification_returns_404(setup_api):
    client, stub, learner_id, certification_id = setup_api
    stub.error = CertificationNotFoundError("Certification not found")
    response = client.post(
        EXAMS_URL, json=payload(certification_id), headers=headers(learner_id)
    )
    assert response.status_code == 404
    assert stub.deliveries == []


def test_insufficient_pool_returns_409(setup_api):
    client, stub, learner_id, certification_id = setup_api
    stub.error = InsufficientQuestionsError(requested=5, available=2)
    response = client.post(
        EXAMS_URL, json=payload(certification_id, 5), headers=headers(learner_id)
    )
    assert response.status_code == 409
    assert response.json()["detail"] == {
        "code": "INSUFFICIENT_QUESTIONS",
        "requested": 5,
        "available": 2,
    }
    assert stub.deliveries == []


@pytest.fixture
def postgres_api_session():
    """Create an isolated temporary schema on LOCAL PostgreSQL only."""
    import os

    from sqlalchemy import text
    from sqlmodel import Session, SQLModel

    from app import models  # noqa: F401
    from app.db.session import engine

    if os.getenv("RUN_DB_INTEGRATION") != "1":
        pytest.skip("PostgreSQL integration tests are opt-in")
    if engine.url.get_backend_name() != "postgresql":
        pytest.fail("PostgreSQL is required")
    if engine.url.host not in ("localhost", "127.0.0.1", None):
        pytest.fail("Tests must use local PostgreSQL")

    schema = f"jhep29_api_{uuid4().hex[:12]}"
    with engine.connect() as connection:
        outer = connection.begin()
        try:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
            scoped = connection.execution_options(schema_translate_map={None: schema})
            SQLModel.metadata.create_all(scoped)
            with Session(
                bind=scoped, join_transaction_mode="create_savepoint"
            ) as session:
                yield session
        finally:
            outer.rollback()


def test_postgres_endpoint_creates_and_delivers_exam(postgres_api_session):
    """Exercise actual selection, persistence, and safe content retrieval."""
    from datetime import UTC, datetime

    from sqlmodel import select

    from app.api.v1.endpoints.exams import get_exam_service as service_dependency
    from app.db.session import get_session
    from app.models import (
        AnswerOption,
        Certification,
        ExamAttempt,
        ExamAttemptQuestion,
        Question,
        QuestionVersion,
        User,
    )

    session = postgres_api_session
    learner = User(email=f"api-{uuid4().hex}@example.com")
    cert = Certification(name="Practice Exam", code=uuid4().hex[:10])
    session.add_all([learner, cert])
    session.flush()

    question = Question(
        certification_id=cert.id, difficulty="easy", created_by_id=learner.id
    )
    session.add(question)
    session.flush()
    version = QuestionVersion(
        question_id=question.id,
        version_number=1,
        question_text="Français — ∫x² dx ≠ 0 😊",
        question_type="multiple_choice",
        review_status="approved",
        publication_status="active",
        submitted_by_id=learner.id,
        reviewed_by_id=learner.id,
        reviewed_at=datetime.now(UTC),
    )
    session.add(version)
    session.flush()
    secret_option = AnswerOption(
        question_version_id=version.id,
        position=1,
        option_text="Réponse A",
        is_correct=True,
    )
    session.add_all(
        [
            secret_option,
            AnswerOption(
                question_version_id=version.id,
                position=2,
                option_text="Réponse B",
                is_correct=False,
            ),
        ]
    )
    session.flush()

    def session_override():
        yield session

    # Use REAL ExamService and its PostgreSQL-backed selector, not the stub.
    app.dependency_overrides.pop(service_dependency, None)
    app.dependency_overrides[get_session] = session_override
    try:
        with TestClient(app) as client:
            response = client.post(
                EXAMS_URL,
                json=payload(cert.id),
                headers=headers(learner.id),
            )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["question_count"] == 1
        assert len(body["questions"]) == 1
        item = body["questions"][0]
        assert item["id"] == str(version.id)
        assert item["question_text"] == "Français — ∫x² dx ≠ 0 😊"
        assert item["position"] == 1
        assert item["options"][0]["id"] == str(secret_option.id)
        assert "is_correct" not in response.text
        assert "expected_answer" not in response.text

        stored_attempt = session.get(ExamAttempt, UUID(body["attempt_id"]))
        assert stored_attempt is not None
        assert stored_attempt.user_id == learner.id
        assignments = session.exec(
            select(ExamAttemptQuestion).where(
                ExamAttemptQuestion.attempt_id == stored_attempt.id
            )
        ).all()
        assert len(assignments) == 1
        assert assignments[0].question_version_id == version.id
    finally:
        app.dependency_overrides.pop(get_session, None)
