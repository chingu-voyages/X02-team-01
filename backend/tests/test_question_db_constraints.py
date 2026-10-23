import os
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import insert, text
from sqlalchemy.exc import IntegrityError
from sqlmodel import SQLModel

from app import models  # noqa: F401
from app.db.session import engine


@pytest.fixture
def db():
    if os.getenv("RUN_DB_INTEGRATION") != "1":
        pytest.skip("PostgreSQL integration tests are opt-in")

    if engine.url.get_backend_name() != "postgresql":
        pytest.fail("PostgreSQL is required")

    if engine.url.host not in ("localhost", "127.0.0.1", None):
        pytest.fail("Tests must use local PostgreSQL")

    schema = f"jhep21_test_{uuid4().hex[:12]}"

    with engine.connect() as connection:
        transaction = connection.begin()

        try:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))

            scoped = connection.execution_options(schema_translate_map={None: schema})

            SQLModel.metadata.create_all(scoped)

            yield scoped

        finally:
            transaction.rollback()


def create_question(db):
    tables = SQLModel.metadata.tables

    user_id = uuid4()
    certification_id = uuid4()
    category_id = uuid4()
    question_id = uuid4()

    db.execute(
        insert(tables["users"]).values(
            id=user_id,
            email="test@example.com",
        )
    )

    db.execute(
        insert(tables["certifications"]).values(
            id=certification_id,
            name="Test Certification",
            code="TEST",
        )
    )

    db.execute(
        insert(tables["categories"]).values(
            id=category_id,
            certification_id=certification_id,
            name="Test Category",
        )
    )

    db.execute(
        insert(tables["questions"]).values(
            id=question_id,
            certification_id=certification_id,
            category_id=category_id,
            difficulty="easy",
            created_by_id=user_id,
            created_at=datetime.now(UTC),
        )
    )

    return user_id, certification_id, question_id


def create_version(
    db,
    user_id,
    question_id,
    number=1,
    review_status="pending",
    publication_status="draft",
):
    version_id = uuid4()
    reviewed = review_status != "pending"

    db.execute(
        insert(SQLModel.metadata.tables["question_versions"]).values(
            id=version_id,
            question_id=question_id,
            version_number=number,
            question_text="Which statements are correct?",
            question_type="multiple_choice",
            allows_multiple_answers=True,
            review_status=review_status,
            publication_status=publication_status,
            is_flagged=False,
            submitted_by_id=user_id,
            submitted_at=datetime.now(UTC),
            reviewed_by_id=user_id if reviewed else None,
            reviewed_at=(datetime.now(UTC) if reviewed else None),
        )
    )

    return version_id


def test_unapproved_question_cannot_be_active(db):
    user_id, _, question_id = create_question(db)

    with pytest.raises(IntegrityError):
        create_version(
            db,
            user_id,
            question_id,
            review_status="pending",
            publication_status="active",
        )


def test_only_one_active_version(db):
    user_id, _, question_id = create_question(db)

    create_version(
        db,
        user_id,
        question_id,
        number=1,
        review_status="approved",
        publication_status="active",
    )

    with pytest.raises(IntegrityError):
        create_version(
            db,
            user_id,
            question_id,
            number=2,
            review_status="approved",
            publication_status="active",
        )


def test_multiple_correct_answers_allowed(db):
    user_id, _, question_id = create_question(db)
    version_id = create_version(db, user_id, question_id)

    options = SQLModel.metadata.tables["answer_options"]

    for position in (1, 2):
        db.execute(
            insert(options).values(
                id=uuid4(),
                question_version_id=version_id,
                option_text=f"Correct option {position}",
                is_correct=True,
                position=position,
            )
        )


def test_duplicate_answer_positions_rejected(db):
    user_id, _, question_id = create_question(db)
    version_id = create_version(db, user_id, question_id)

    options = SQLModel.metadata.tables["answer_options"]

    db.execute(
        insert(options).values(
            id=uuid4(),
            question_version_id=version_id,
            option_text="Option A",
            is_correct=True,
            position=1,
        )
    )

    with pytest.raises(IntegrityError):
        db.execute(
            insert(options).values(
                id=uuid4(),
                question_version_id=version_id,
                option_text="Option B",
                is_correct=False,
                position=1,
            )
        )


def test_category_must_match_certification(db):
    user_id, certification_id, _ = create_question(db)

    tables = SQLModel.metadata.tables

    other_certification = uuid4()
    other_category = uuid4()

    db.execute(
        insert(tables["certifications"]).values(
            id=other_certification,
            name="Other Certification",
            code="OTHER",
        )
    )

    db.execute(
        insert(tables["categories"]).values(
            id=other_category,
            certification_id=other_certification,
            name="Other Category",
        )
    )

    with pytest.raises(IntegrityError):
        db.execute(
            insert(tables["questions"]).values(
                id=uuid4(),
                certification_id=certification_id,
                category_id=other_category,
                difficulty="easy",
                created_by_id=user_id,
                created_at=datetime.now(UTC),
            )
        )
