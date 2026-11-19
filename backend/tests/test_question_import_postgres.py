"""PostgreSQL integration coverage for JHEP-118 bulk import commits.

Opt in with:

    RUN_DB_INTEGRATION=1 pytest tests/test_question_import_postgres.py -q

The tests require local PostgreSQL. Each test uses an isolated temporary
schema inside an outer transaction, so application data is not modified.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlmodel import Session, SQLModel, select

from app import models  # noqa: F401
from app.core.roles import UserRole
from app.db.session import engine
from app.models.answer_option import AnswerOption
from app.models.category import Category
from app.models.certification import Certification
from app.models.question import Question
from app.models.question_import_batch import QuestionImportBatch
from app.models.question_import_row import QuestionImportRow
from app.models.question_version import QuestionVersion
from app.models.text_answer_key import TextAnswerKey
from app.models.user import User
from app.services.question_import_commit_service import (
    QuestionImportCommitDataError,
    QuestionImportCommitNotFoundError,
    commit_question_import_batch,
)
from app.services.question_import_validation_service import (
    question_content_fingerprint,
)


@pytest.fixture
def pg_session() -> Iterator[Session]:
    """Return an isolated PostgreSQL session for one integration test."""

    if os.getenv("RUN_DB_INTEGRATION") != "1":
        pytest.skip("PostgreSQL integration tests are opt-in")

    if engine.url.get_backend_name() != "postgresql":
        pytest.fail("PostgreSQL integration tests require PostgreSQL")

    if engine.url.host not in {"localhost", "127.0.0.1", None}:
        pytest.fail("Refusing to run integration tests on remote PostgreSQL")

    schema = f"jhep118_import_{uuid4().hex[:12]}"

    with engine.connect() as connection:
        outer = connection.begin()

        try:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))

            scoped = connection.execution_options(
                schema_translate_map={
                    None: schema,
                }
            )

            SQLModel.metadata.create_all(scoped)

            with Session(
                bind=scoped,
                join_transaction_mode="create_savepoint",
            ) as session:
                yield session

        finally:
            outer.rollback()


def create_user(
    session: Session,
    *,
    role: UserRole,
) -> User:
    user = User(
        email=f"{uuid4()}@example.test",
        full_name="Integration User",
        role=role,
        is_verified=True,
    )

    session.add(user)
    session.commit()
    session.refresh(user)

    return user


def seed_catalog(
    session: Session,
) -> tuple[Certification, Category]:
    certification = Certification(
        name="JHEP-118 PostgreSQL Test Certification",
        code=f"J118-{uuid4().hex[:8].upper()}",
        is_published=True,
    )

    session.add(certification)
    session.flush()

    category = Category(
        certification_id=certification.id,
        name="Integration",
        is_published=True,
    )

    session.add(category)
    session.commit()
    session.refresh(certification)
    session.refresh(category)

    return certification, category


def normalized_mc(
    *,
    certification: Certification,
    category: Category,
    question_text: str,
) -> dict[str, object]:
    return {
        "certification_id": str(certification.id),
        "category_id": str(category.id),
        "difficulty": "medium",
        "question_text": question_text,
        "question_type": "multiple_choice",
        "allows_multiple_answers": False,
        "explanation": "Integration test explanation.",
        "options": [
            {
                "option_text": "Correct option",
                "is_correct": True,
            },
            {
                "option_text": "Incorrect option",
                "is_correct": False,
            },
        ],
        "expected_answer": None,
        "image_filename": None,
        "image_alt_text": None,
    }


def normalized_short_answer(
    *,
    certification: Certification,
    category: Category,
    question_text: str,
) -> dict[str, object]:
    return {
        "certification_id": str(certification.id),
        "category_id": str(category.id),
        "difficulty": "easy",
        "question_text": question_text,
        "question_type": "short_answer",
        "allows_multiple_answers": False,
        "explanation": "Integration test explanation.",
        "options": [],
        "expected_answer": "Expected integration answer",
        "image_filename": None,
        "image_alt_text": None,
    }


def create_ready_batch(
    session: Session,
    *,
    uploader: User,
    certification: Certification,
    category: Category,
    rows: list[dict[str, object]],
) -> QuestionImportBatch:
    batch = QuestionImportBatch(
        uploaded_by_id=uploader.id,
        original_filename="postgres-integration.xlsx",
        file_type="xlsx",
        file_size_bytes=1024,
        file_sha256=uuid4().hex + uuid4().hex,
        template_version="2.0",
        status="ready",
        total_rows=len(rows),
        valid_rows=len(rows),
        error_rows=0,
        warning_rows=0,
        imported_rows=0,
    )

    session.add(batch)
    session.flush()

    for row_number, payload in enumerate(
        rows,
        start=2,
    ):
        fingerprint = question_content_fingerprint(
            certification_id=certification.id,
            category_id=category.id,
            question_type=str(payload["question_type"]),
            question_text=str(payload["question_text"]),
        )

        session.add(
            QuestionImportRow(
                batch_id=batch.id,
                row_number=row_number,
                raw_payload={},
                normalized_payload=payload,
                validation_issues=[],
                status="valid",
                content_fingerprint=fingerprint,
            )
        )

    session.commit()
    session.refresh(batch)

    return batch


def test_postgres_commit_persists_entire_ready_batch_with_provenance(
    pg_session: Session,
) -> None:
    contributor = create_user(
        pg_session,
        role=UserRole.CONTRIBUTOR,
    )

    certification, category = seed_catalog(
        pg_session
    )

    batch = create_ready_batch(
        pg_session,
        uploader=contributor,
        certification=certification,
        category=category,
        rows=[
            normalized_mc(
                certification=certification,
                category=category,
                question_text="PostgreSQL MCQ import question",
            ),
            normalized_short_answer(
                certification=certification,
                category=category,
                question_text="PostgreSQL short-answer import question",
            ),
        ],
    )

    result = commit_question_import_batch(
        pg_session,
        batch_id=batch.id,
        actor=contributor,
    )

    assert result.already_imported is False
    assert result.imported_rows == 2
    assert len(result.created_question_ids) == 2

    questions = pg_session.exec(
        select(Question).order_by(Question.created_at)
    ).all()

    versions = pg_session.exec(
        select(QuestionVersion).order_by(
            QuestionVersion.submitted_at
        )
    ).all()

    rows = pg_session.exec(
        select(QuestionImportRow).order_by(
            QuestionImportRow.row_number
        )
    ).all()

    assert len(questions) == 2
    assert len(versions) == 2

    assert all(
        question.created_by_id == contributor.id
        for question in questions
    )

    assert all(
        version.review_status == "pending"
        and version.publication_status == "draft"
        and version.version_number == 1
        and version.submitted_by_id == contributor.id
        for version in versions
    )

    assert len(
        pg_session.exec(select(AnswerOption)).all()
    ) == 2

    assert len(
        pg_session.exec(select(TextAnswerKey)).all()
    ) == 1

    assert all(
        row.status == "imported"
        and row.created_question_id is not None
        and row.created_question_version_id is not None
        for row in rows
    )

    pg_session.refresh(batch)

    assert batch.status == "imported"
    assert batch.imported_rows == 2
    assert batch.imported_at is not None


def test_postgres_commit_rolls_back_all_rows_when_later_payload_is_invalid(
    pg_session: Session,
) -> None:
    contributor = create_user(
        pg_session,
        role=UserRole.CONTRIBUTOR,
    )

    certification, category = seed_catalog(
        pg_session
    )

    first = normalized_mc(
        certification=certification,
        category=category,
        question_text="First row should roll back",
    )

    second = normalized_mc(
        certification=certification,
        category=category,
        question_text="Second row is corrupted",
    )

    second["difficulty"] = "impossible"

    batch = create_ready_batch(
        pg_session,
        uploader=contributor,
        certification=certification,
        category=category,
        rows=[
            first,
            second,
        ],
    )

    with pytest.raises(
        QuestionImportCommitDataError
    ):
        commit_question_import_batch(
            pg_session,
            batch_id=batch.id,
            actor=contributor,
        )

    assert (
        pg_session.exec(
            select(Question)
        ).all()
        == []
    )

    rows = pg_session.exec(
        select(QuestionImportRow).order_by(
            QuestionImportRow.row_number
        )
    ).all()

    assert len(rows) == 2
    assert all(
        row.status == "valid"
        and row.created_question_id is None
        and row.created_question_version_id is None
        for row in rows
    )

    refreshed_batch = pg_session.get(
        QuestionImportBatch,
        batch.id,
    )

    assert refreshed_batch is not None
    assert refreshed_batch.status == "ready"
    assert refreshed_batch.imported_rows == 0


def test_postgres_commit_is_idempotent_and_preserves_original_uploader(
    pg_session: Session,
) -> None:
    contributor = create_user(
        pg_session,
        role=UserRole.CONTRIBUTOR,
    )

    administrator = create_user(
        pg_session,
        role=UserRole.ADMINISTRATOR,
    )

    certification, category = seed_catalog(
        pg_session
    )

    batch = create_ready_batch(
        pg_session,
        uploader=contributor,
        certification=certification,
        category=category,
        rows=[
            normalized_mc(
                certification=certification,
                category=category,
                question_text="Administrator-confirmed contributor import",
            )
        ],
    )

    first = commit_question_import_batch(
        pg_session,
        batch_id=batch.id,
        actor=administrator,
    )

    second = commit_question_import_batch(
        pg_session,
        batch_id=batch.id,
        actor=administrator,
    )

    assert first.already_imported is False
    assert second.already_imported is True
    assert (
        second.created_question_ids
        == first.created_question_ids
    )

    questions = pg_session.exec(
        select(Question)
    ).all()

    assert len(questions) == 1
    assert (
        questions[0].created_by_id
        == contributor.id
    )

    version = pg_session.exec(
        select(QuestionVersion)
    ).one()

    assert (
        version.submitted_by_id
        == contributor.id
    )


def test_postgres_contributor_cannot_commit_another_contributors_batch(
    pg_session: Session,
) -> None:
    owner = create_user(
        pg_session,
        role=UserRole.CONTRIBUTOR,
    )

    other = create_user(
        pg_session,
        role=UserRole.CONTRIBUTOR,
    )

    certification, category = seed_catalog(
        pg_session
    )

    batch = create_ready_batch(
        pg_session,
        uploader=owner,
        certification=certification,
        category=category,
        rows=[
            normalized_mc(
                certification=certification,
                category=category,
                question_text="Owner-only PostgreSQL import",
            )
        ],
    )

    with pytest.raises(
        QuestionImportCommitNotFoundError
    ):
        commit_question_import_batch(
            pg_session,
            batch_id=batch.id,
            actor=other,
        )

    assert (
        pg_session.exec(
            select(Question)
        ).all()
        == []
    )
