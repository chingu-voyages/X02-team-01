"""AC3: image metadata is version-pinned, batched, and response-safe."""

import os
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, SQLModel

from app import models  # noqa: F401
from app.core.config import settings
from app.models import (
    AnswerOption,
    Certification,
    Question,
    QuestionImage,
    QuestionVersion,
    User,
)
from app.services.exam_service import ExamService


def test_image_urls_reject_path_traversal(monkeypatch):
    monkeypatch.setattr(settings, "media_base_url", "https://cdn.example.test/images")
    assert ExamService._image_url("../secret") is None
    assert ExamService._image_url("/absolute") is None
    assert ExamService._image_url("../outside.png") is None
    assert ExamService._image_url("diagram\\evil.png") is None
    assert ExamService._image_url("questions/fig ü.png") == (
        "https://cdn.example.test/images/questions/fig%20%C3%BC.png"
    )


def test_missing_media_base_uses_alt_text_fallback(monkeypatch):
    monkeypatch.setattr(settings, "media_base_url", None)
    assert ExamService._image_url("questions/valid.webp") is None


@pytest.fixture
def postgres_session():
    if os.getenv("RUN_DB_INTEGRATION") != "1":
        pytest.skip("PostgreSQL integration tests are opt-in")
    from app.db.session import engine

    if engine.url.get_backend_name() != "postgresql" or engine.url.host not in {
        "localhost",
        "127.0.0.1",
        None,
    }:
        pytest.fail("Requires local PostgreSQL")

    schema = f"jhep29_media_{uuid4().hex[:12]}"
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


def test_version_pinned_media_is_in_exam_delivery(postgres_session, monkeypatch):
    monkeypatch.setattr(settings, "media_base_url", "https://cdn.example.test")
    user = User(email=f"media-{uuid4().hex}@example.test")
    cert = Certification(name="Media", code=uuid4().hex[:10], passing_threshold_pct=70)
    postgres_session.add_all([user, cert])
    postgres_session.flush()
    question = Question(
        certification_id=cert.id, created_by_id=user.id, difficulty="medium"
    )
    postgres_session.add(question)
    postgres_session.flush()
    version = QuestionVersion(
        question_id=question.id,
        version_number=1,
        question_text="Calculate \\(x^2 + π\\) — diagram attached",
        question_type="multiple_choice",
        review_status="approved",
        publication_status="active",
        reviewed_by_id=user.id,
        reviewed_at=datetime.now(UTC),
        submitted_by_id=user.id,
    )
    postgres_session.add(version)
    postgres_session.flush()
    postgres_session.add_all(
        [
            AnswerOption(
                question_version_id=version.id,
                option_text="A",
                position=1,
                is_correct=True,
            ),
            AnswerOption(
                question_version_id=version.id,
                option_text="B",
                position=2,
                is_correct=False,
            ),
            QuestionImage(
                question_version_id=version.id,
                storage_key="questions/diagram-ü.webp",
                alt_text="Triangle: côtés 3, 4 et 5",
                media_type="image/webp",
                position=1,
            ),
        ]
    )
    postgres_session.flush()

    service = ExamService(postgres_session)
    created = service.create_exam(
        learner_id=user.id, certification_id=cert.id, question_count=1
    )
    questions = service.get_exam_questions(created.attempt_id)
    assert len(questions) == 1
    assert questions[0].question_text == "Calculate \\(x^2 + π\\) — diagram attached"
    assert len(questions[0].images) == 1
    image = questions[0].images[0]
    assert image.alt_text == "Triangle: côtés 3, 4 et 5"
    assert image.url == "https://cdn.example.test/questions/diagram-%C3%BC.webp"
    assert "storage_key" not in vars(image)
    assert "is_correct" not in str(vars(image))

    # No CDN configuration should preserve metadata and provide a graceful
    # null URL, allowing a frontend to render the accessible alt-text fallback.
    monkeypatch.setattr(settings, "media_base_url", None)
    no_cdn = service.get_exam_questions(created.attempt_id)
    assert len(no_cdn[0].images) == 1
    assert no_cdn[0].images[0].url is None
    assert no_cdn[0].images[0].alt_text == image.alt_text

    # Unsupported SVGs are blocked by the database's media type constraint.
    savepoint = postgres_session.begin_nested()
    postgres_session.add(
        QuestionImage(
            question_version_id=version.id,
            storage_key="questions/unsupported.svg",
            alt_text="Unsupported vector image",
            media_type="image/svg+xml",
            position=2,
        )
    )
    with pytest.raises(IntegrityError):
        postgres_session.flush()
    savepoint.rollback()
