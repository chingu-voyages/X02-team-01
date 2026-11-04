"""JHEP-27: selected categories must constrain exam generation."""

import os
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app import models  # noqa: F401
from app.api.v1.endpoints.exams import get_exam_service
from app.core.security import create_access_token
from app.main import app
from app.models import (
    AnswerOption,
    Category,
    Certification,
    ExamAttemptQuestion,
    Question,
    QuestionVersion,
    User,
)
from app.repositories.sqlmodel_repository import SQLModelQuestionRepository
from app.services.exam_service import (
    CategoryUnavailableError,
    CreatedExam,
    InvalidCategoryError,
)

EXAMS_URL = "/api/v1/exams"


def _headers(learner_id: UUID) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(str(learner_id))}"}


def _add_multiple_choice(
    session: Session,
    *,
    author: User,
    certification: Certification,
    category: Category,
    text_value: str,
) -> tuple[Question, QuestionVersion]:
    question = Question(
        certification_id=certification.id,
        category_id=category.id,
        difficulty="easy",
        created_by_id=author.id,
    )
    session.add(question)
    session.flush()

    version = QuestionVersion(
        question_id=question.id,
        version_number=1,
        question_text=text_value,
        question_type="multiple_choice",
        review_status="approved",
        publication_status="active",
        submitted_by_id=author.id,
        reviewed_by_id=author.id,
        reviewed_at=datetime.now(UTC),
    )
    session.add(version)
    session.flush()
    session.add_all(
        [
            AnswerOption(
                question_version_id=version.id,
                position=1,
                option_text="Correct",
                is_correct=True,
            ),
            AnswerOption(
                question_version_id=version.id,
                position=2,
                option_text="Incorrect",
                is_correct=False,
            ),
        ]
    )
    session.flush()
    return question, version


@pytest.fixture
def selector_session() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    tables = [
        User.__table__,
        Certification.__table__,
        Category.__table__,
        Question.__table__,
        QuestionVersion.__table__,
        AnswerOption.__table__,
    ]
    SQLModel.metadata.create_all(engine, tables=tables)
    with Session(engine) as session:
        yield session


def test_selector_returns_questions_only_from_selected_category(selector_session):
    author = User(email=f"selector-{uuid4().hex}@example.test")
    certification = Certification(
        name="Practice Exam",
        code=uuid4().hex[:12],
        passing_threshold_pct=70,
    )
    selector_session.add_all([author, certification])
    selector_session.flush()
    first = Category(
        certification_id=certification.id,
        name="Agile Fundamentals",
        is_published=True,
    )
    second = Category(
        certification_id=certification.id,
        name="Practice Set B",
        is_published=True,
    )
    selector_session.add_all([first, second])
    selector_session.flush()

    first_question, first_version = _add_multiple_choice(
        selector_session,
        author=author,
        certification=certification,
        category=first,
        text_value="First category question",
    )
    second_question, second_version = _add_multiple_choice(
        selector_session,
        author=author,
        certification=certification,
        category=second,
        text_value="Second category question",
    )
    selector_session.commit()

    repository = SQLModelQuestionRepository(selector_session)
    selected = repository.select_random_eligible(
        certification.id,
        10,
        category_id=first.id,
    )

    assert {row.question_id for row in selected} == {first_question.id}
    assert {row.question_version_id for row in selected} == {first_version.id}
    assert second_question.id not in {row.question_id for row in selected}
    assert second_version.id not in {row.question_version_id for row in selected}


def test_selector_without_category_preserves_certification_wide_behavior(
    selector_session,
):
    author = User(email=f"selector-all-{uuid4().hex}@example.test")
    certification = Certification(
        name="Practice Exam",
        code=uuid4().hex[:12],
        passing_threshold_pct=70,
    )
    selector_session.add_all([author, certification])
    selector_session.flush()
    categories = [
        Category(
            certification_id=certification.id,
            name=name,
            is_published=True,
        )
        for name in ("A", "B")
    ]
    selector_session.add_all(categories)
    selector_session.flush()

    versions = {
        _add_multiple_choice(
            selector_session,
            author=author,
            certification=certification,
            category=category,
            text_value=f"Question {category.name}",
        )[1].id
        for category in categories
    }
    selector_session.commit()

    selected = SQLModelQuestionRepository(selector_session).select_random_eligible(
        certification.id,
        10,
    )

    assert {row.question_version_id for row in selected} == versions


class SpyExamService:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.calls: list[dict[str, object]] = []
        self.attempt_id = uuid4()

    def create_exam(
        self,
        *,
        learner_id,
        certification_id,
        question_count,
        category_id=None,
    ):
        self.calls.append(
            {
                "learner_id": learner_id,
                "certification_id": certification_id,
                "question_count": question_count,
                "category_id": category_id,
            }
        )
        if self.error is not None:
            raise self.error
        return CreatedExam(
            attempt_id=self.attempt_id,
            certification_id=certification_id,
            question_count=question_count,
        )

    def get_exam_questions(self, attempt_id):
        assert attempt_id == self.attempt_id
        return []


@pytest.fixture
def api_client():
    learner_id = uuid4()
    certification_id = uuid4()
    category_id = uuid4()
    service = SpyExamService()
    app.dependency_overrides[get_exam_service] = lambda: service
    try:
        with TestClient(app) as client:
            yield client, service, learner_id, certification_id, category_id
    finally:
        app.dependency_overrides.pop(get_exam_service, None)


def test_api_passes_selected_category_to_exam_service(api_client):
    client, service, learner_id, certification_id, category_id = api_client

    response = client.post(
        EXAMS_URL,
        json={
            "certification_id": str(certification_id),
            "category_id": str(category_id),
            "question_count": 1,
        },
        headers=_headers(learner_id),
    )

    assert response.status_code == 201
    assert service.calls == [
        {
            "learner_id": learner_id,
            "certification_id": certification_id,
            "question_count": 1,
            "category_id": category_id,
        }
    ]


def test_unknown_or_cross_certification_category_returns_404(api_client):
    client, service, learner_id, certification_id, category_id = api_client
    service.error = InvalidCategoryError("Category is not part of this certification")

    response = client.post(
        EXAMS_URL,
        json={
            "certification_id": str(certification_id),
            "category_id": str(category_id),
            "question_count": 1,
        },
        headers=_headers(learner_id),
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "Category not found"}


def test_unpublished_category_returns_conflict(api_client):
    client, service, learner_id, certification_id, category_id = api_client
    service.error = CategoryUnavailableError("Category is not available")

    response = client.post(
        EXAMS_URL,
        json={
            "certification_id": str(certification_id),
            "category_id": str(category_id),
            "question_count": 1,
        },
        headers=_headers(learner_id),
    )

    assert response.status_code == 409
    assert response.json() == {
        "detail": {
            "code": "CATEGORY_UNAVAILABLE",
            "message": "Category is not available",
        }
    }


@pytest.fixture
def postgres_session():
    if os.getenv("RUN_DB_INTEGRATION") != "1":
        pytest.skip("PostgreSQL integration tests are opt-in")

    from app.db.session import engine

    if engine.url.get_backend_name() != "postgresql":
        pytest.fail("PostgreSQL is required")
    if engine.url.host not in ("localhost", "127.0.0.1", None):
        pytest.fail("Tests must use local PostgreSQL")

    schema = f"jhep27_category_start_{uuid4().hex[:12]}"
    with engine.connect() as connection:
        outer = connection.begin()
        try:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
            scoped = connection.execution_options(schema_translate_map={None: schema})
            SQLModel.metadata.create_all(scoped)
            with Session(
                bind=scoped,
                join_transaction_mode="create_savepoint",
            ) as session:
                yield session
        finally:
            outer.rollback()


def test_postgres_exam_creation_stays_inside_selected_category(postgres_session):
    from app.services.exam_service import ExamService

    learner = User(email=f"postgres-category-{uuid4().hex}@example.test")
    certification = Certification(
        name="Postgres Practice Exam",
        code=uuid4().hex[:12],
        passing_threshold_pct=70,
    )
    postgres_session.add_all([learner, certification])
    postgres_session.flush()
    selected_category = Category(
        certification_id=certification.id,
        name="Selected",
        is_published=True,
    )
    other_category = Category(
        certification_id=certification.id,
        name="Other",
        is_published=True,
    )
    postgres_session.add_all([selected_category, other_category])
    postgres_session.flush()

    selected_question, _ = _add_multiple_choice(
        postgres_session,
        author=learner,
        certification=certification,
        category=selected_category,
        text_value="Selected category only",
    )
    other_question, _ = _add_multiple_choice(
        postgres_session,
        author=learner,
        certification=certification,
        category=other_category,
        text_value="Must not be selected",
    )
    postgres_session.commit()

    created = ExamService(postgres_session).create_exam(
        learner_id=learner.id,
        certification_id=certification.id,
        category_id=selected_category.id,
        question_count=1,
    )
    assignment = postgres_session.exec(
        select(ExamAttemptQuestion).where(
            ExamAttemptQuestion.attempt_id == created.attempt_id
        )
    ).one()

    assert assignment.question_id == selected_question.id
    assert assignment.question_id != other_question.id
