import os
from collections.abc import Iterator
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import insert, text
from sqlmodel import Session, SQLModel

from app import models  # noqa: F401
from app.api.v1.endpoints.questions import get_question_repository
from app.core.security import create_access_token
from app.db.session import engine
from app.main import app
from app.repositories.sqlmodel_repository import SQLModelQuestionRepository

QUESTIONS_URL = "/api/v1/questions"


@pytest.fixture
def db() -> Iterator[object]:
    if os.getenv("RUN_DB_INTEGRATION") != "1":
        pytest.skip("PostgreSQL integration tests are opt-in")

    if engine.url.get_backend_name() != "postgresql":
        pytest.fail("PostgreSQL is required")

    if engine.url.host not in ("localhost", "127.0.0.1", None):
        pytest.fail("Tests must use local PostgreSQL")

    schema = f"jhep22_test_{uuid4().hex[:12]}"

    with engine.connect() as connection:
        transaction = connection.begin()

        try:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))

            scoped = connection.execution_options(schema_translate_map={None: schema})

            SQLModel.metadata.create_all(scoped)

            yield scoped

        finally:
            transaction.rollback()


@pytest.fixture
def bank(db):
    tables = SQLModel.metadata.tables

    user_id = uuid4()
    certification_id = uuid4()
    category_id = uuid4()

    db.execute(
        insert(tables["users"]).values(
            id=user_id,
            email="owner@example.com",
        )
    )
    db.execute(
        insert(tables["certifications"]).values(
            id=certification_id,
            name="Professional Scrum Master",
            code="PSM",
        )
    )
    db.execute(
        insert(tables["categories"]).values(
            id=category_id,
            certification_id=certification_id,
            name="Scrum Events",
        )
    )

    def create_question(
        *,
        difficulty: str,
        question_text: str,
        question_type: str,
        review_status: str,
        publication_status: str,
        is_flagged: bool = False,
        options: tuple[tuple[int, str, bool], ...] = (),
        expected_answer: str | None = None,
    ) -> tuple[UUID, UUID]:
        question_id = uuid4()
        version_id = uuid4()
        reviewed = review_status != "pending"

        db.execute(
            insert(tables["questions"]).values(
                id=question_id,
                certification_id=certification_id,
                category_id=category_id,
                difficulty=difficulty,
                created_by_id=user_id,
                created_at=datetime.now(UTC),
            )
        )
        db.execute(
            insert(tables["question_versions"]).values(
                id=version_id,
                question_id=question_id,
                version_number=1,
                question_text=question_text,
                question_type=question_type,
                allows_multiple_answers=sum(
                    1 for _, _, is_correct in options if is_correct
                )
                > 1,
                review_status=review_status,
                publication_status=publication_status,
                is_flagged=is_flagged,
                submitted_by_id=user_id,
                submitted_at=datetime.now(UTC),
                reviewed_by_id=user_id if reviewed else None,
                reviewed_at=datetime.now(UTC) if reviewed else None,
            )
        )

        for position, option_text, is_correct in options:
            db.execute(
                insert(tables["answer_options"]).values(
                    id=uuid4(),
                    question_version_id=version_id,
                    option_text=option_text,
                    is_correct=is_correct,
                    position=position,
                )
            )

        if expected_answer is not None:
            db.execute(
                insert(tables["text_answer_keys"]).values(
                    id=uuid4(),
                    question_version_id=version_id,
                    expected_answer=expected_answer,
                )
            )

        return question_id, version_id

    eligible_multiple_choice = create_question(
        difficulty="easy",
        question_text="Which event is timeboxed to 15 minutes?",
        question_type="multiple_choice",
        review_status="approved",
        publication_status="active",
        options=(
            (1, "Daily Scrum", True),
            (2, "Sprint Review", False),
            (3, "Sprint Retrospective", False),
        ),
    )

    eligible_short_answer = create_question(
        difficulty="medium",
        question_text="Name the artifact that lists ordered work for a Sprint.",
        question_type="short_answer",
        review_status="approved",
        publication_status="active",
        expected_answer="Sprint Backlog",
    )

    eligible_multi_select = create_question(
        difficulty="hard",
        question_text="Select every Scrum value.",
        question_type="multiple_choice",
        review_status="approved",
        publication_status="active",
        options=(
            (1, "Focus", True),
            (2, "Synergy", False),
            (3, "Respect", True),
        ),
    )

    create_question(
        difficulty="easy",
        question_text="Pending question",
        question_type="multiple_choice",
        review_status="pending",
        publication_status="draft",
        options=((1, "A", True), (2, "B", False)),
    )
    create_question(
        difficulty="easy",
        question_text="Rejected question",
        question_type="multiple_choice",
        review_status="rejected",
        publication_status="draft",
        options=((1, "A", True), (2, "B", False)),
    )
    create_question(
        difficulty="easy",
        question_text="Draft question",
        question_type="multiple_choice",
        review_status="approved",
        publication_status="draft",
        options=((1, "A", True), (2, "B", False)),
    )
    create_question(
        difficulty="easy",
        question_text="Retired question",
        question_type="multiple_choice",
        review_status="approved",
        publication_status="retired",
        options=((1, "A", True), (2, "B", False)),
    )
    flagged = create_question(
        difficulty="medium",
        question_text="Flagged question",
        question_type="multiple_choice",
        review_status="approved",
        publication_status="active",
        is_flagged=True,
        options=((1, "A", True), (2, "B", False)),
    )

    return {
        "user_id": user_id,
        "certification_id": certification_id,
        "eligible_multiple_choice_version": eligible_multiple_choice[1],
        "eligible_short_answer_version": eligible_short_answer[1],
        "eligible_multi_select_version": eligible_multi_select[1],
        "flagged_version": flagged[1],
    }


def test_returns_only_eligible_versions(db, bank):
    repository = SQLModelQuestionRepository(Session(bind=db))

    returned = {question.id for question in repository.list_eligible()}

    assert returned == {
        str(bank["eligible_multiple_choice_version"]),
        str(bank["eligible_short_answer_version"]),
        str(bank["eligible_multi_select_version"]),
    }


def test_flagged_version_is_excluded(db, bank):
    repository = SQLModelQuestionRepository(Session(bind=db))

    returned = {question.id for question in repository.list_eligible()}

    assert str(bank["flagged_version"]) not in returned


def test_multiple_choice_options_are_ordered(db, bank):
    repository = SQLModelQuestionRepository(Session(bind=db))

    question = next(
        question
        for question in repository.list_eligible()
        if question.id == str(bank["eligible_multiple_choice_version"])
    )

    assert [option.position for option in question.options] == [1, 2, 3]
    assert [option.option_text for option in question.options] == [
        "Daily Scrum",
        "Sprint Review",
        "Sprint Retrospective",
    ]
    assert [option.is_correct for option in question.options] == [
        True,
        False,
        False,
    ]


def test_multi_select_flag_and_keys_are_loaded(db, bank):
    repository = SQLModelQuestionRepository(Session(bind=db))

    question = next(
        question
        for question in repository.list_eligible()
        if question.id == str(bank["eligible_multi_select_version"])
    )

    assert question.allows_multiple_answers is True
    assert [option.is_correct for option in question.options] == [
        True,
        False,
        True,
    ]


def test_short_answer_loads_key_and_has_no_options(db, bank):
    repository = SQLModelQuestionRepository(Session(bind=db))

    question = next(
        question
        for question in repository.list_eligible()
        if question.id == str(bank["eligible_short_answer_version"])
    )

    assert question.options == []
    assert question.expected_answer == "Sprint Backlog"
    assert question.difficulty == "medium"


def test_empty_bank_returns_empty_list(db):
    repository = SQLModelQuestionRepository(Session(bind=db))

    assert repository.list_eligible() == []


def test_endpoint_serves_database_rows_without_answer_keys(db, bank):
    def _repository() -> SQLModelQuestionRepository:
        return SQLModelQuestionRepository(Session(bind=db))

    app.dependency_overrides[get_question_repository] = _repository

    try:
        with TestClient(app) as client:
            response = client.get(
                QUESTIONS_URL,
                headers={
                    "Authorization": f"Bearer {create_access_token('test-learner')}"
                },
            )

        assert response.status_code == 200
        payload = response.json()
        assert payload["count"] == 3
        items = {item["id"]: item for item in payload["items"]}
        assert set(items) == {
            str(bank["eligible_multiple_choice_version"]),
            str(bank["eligible_short_answer_version"]),
            str(bank["eligible_multi_select_version"]),
        }
        assert (
            items[str(bank["eligible_multi_select_version"])]["allows_multiple_answers"]
            is True
        )
        assert (
            items[str(bank["eligible_multiple_choice_version"])][
                "allows_multiple_answers"
            ]
            is False
        )
        assert "is_correct" not in response.text
        assert "expected_answer" not in response.text

    finally:
        app.dependency_overrides.clear()


def test_random_selection_only_returns_eligible(db, bank):
    """Only approved, active, unflagged versions are selected."""
    repository = SQLModelQuestionRepository(Session(bind=db))

    selected = repository.select_random_eligible(
        certification_id=bank["certification_id"],
        question_count=20,
    )

    returned_versions = {question.question_version_id for question in selected}
    expected_versions = {
        bank["eligible_multiple_choice_version"],
        bank["eligible_short_answer_version"],
        bank["eligible_multi_select_version"],
    }

    assert returned_versions == expected_versions
    assert bank["flagged_version"] not in returned_versions


def test_random_selection_respects_requested_count(db, bank):
    """The result never exceeds the requested size."""
    repository = SQLModelQuestionRepository(Session(bind=db))

    selected = repository.select_random_eligible(
        certification_id=bank["certification_id"],
        question_count=2,
    )

    assert len(selected) == 2


def test_random_selection_has_no_duplicates(db, bank):
    """Each parent question appears at most once."""
    repository = SQLModelQuestionRepository(Session(bind=db))

    selected = repository.select_random_eligible(
        certification_id=bank["certification_id"],
        question_count=20,
    )

    question_ids = [question.question_id for question in selected]

    assert len(question_ids) == len(set(question_ids))


def test_random_selection_unknown_certification(db):
    """An unknown certification has no eligible questions."""
    repository = SQLModelQuestionRepository(Session(bind=db))

    selected = repository.select_random_eligible(
        certification_id=uuid4(),
        question_count=10,
    )

    assert selected == []


@pytest.mark.parametrize("question_count", [0, -1, -100])
def test_random_selection_rejects_invalid_count(db, question_count):
    """Nonpositive question counts are rejected."""
    repository = SQLModelQuestionRepository(Session(bind=db))

    with pytest.raises(ValueError, match="must be positive"):
        repository.select_random_eligible(
            certification_id=uuid4(),
            question_count=question_count,
        )


def test_random_selection_exposes_only_identifiers(db, bank):
    """Selection data must not include answer keys."""
    repository = SQLModelQuestionRepository(Session(bind=db))

    selected = repository.select_random_eligible(
        certification_id=bank["certification_id"],
        question_count=3,
    )

    assert selected

    for question in selected:
        assert set(vars(question)) == {
            "question_id",
            "question_version_id",
        }


def test_random_selection_is_certification_scoped(db, bank):
    """Questions from another certification are excluded."""
    tables = SQLModel.metadata.tables
    other_certification_id = uuid4()
    other_question_id = uuid4()
    other_version_id = uuid4()
    user_id = bank["user_id"]

    db.execute(
        insert(tables["certifications"]).values(
            id=other_certification_id,
            name="Other Certification",
            code="OTHER",
        )
    )

    db.execute(
        insert(tables["questions"]).values(
            id=other_question_id,
            certification_id=other_certification_id,
            difficulty="easy",
            created_by_id=user_id,
        )
    )

    db.execute(
        insert(tables["question_versions"]).values(
            id=other_version_id,
            question_id=other_question_id,
            version_number=1,
            question_text="What is the other certification?",
            question_type="short_answer",
            review_status="approved",
            publication_status="active",
            submitted_by_id=user_id,
            reviewed_by_id=user_id,
            reviewed_at=datetime.now(UTC),
        )
    )

    db.execute(
        insert(tables["text_answer_keys"]).values(
            id=uuid4(),
            question_version_id=other_version_id,
            expected_answer="Other Certification",
        )
    )

    repository = SQLModelQuestionRepository(Session(bind=db))

    original = repository.select_random_eligible(
        certification_id=bank["certification_id"],
        question_count=20,
    )

    other = repository.select_random_eligible(
        certification_id=other_certification_id,
        question_count=20,
    )

    assert len(original) == 3
    assert other_version_id not in {
        question.question_version_id for question in original
    }
    assert len(other) == 1
    assert other[0].question_version_id == other_version_id
