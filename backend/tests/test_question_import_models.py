from collections.abc import Iterator
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.core.roles import UserRole
from app.models.category import Category
from app.models.certification import Certification
from app.models.question import Question
from app.models.question_import_asset import QuestionImportAsset
from app.models.question_import_batch import QuestionImportBatch
from app.models.question_import_row import QuestionImportRow
from app.models.question_version import QuestionVersion
from app.models.user import User


@pytest.fixture
def engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @sa.event.listens_for(engine, "connect")
    def enable_foreign_keys(
        dbapi_connection,
        _connection_record,
    ):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    SQLModel.metadata.create_all(
        engine,
        tables=[
            User.__table__,
            Certification.__table__,
            Category.__table__,
            Question.__table__,
            QuestionVersion.__table__,
            QuestionImportBatch.__table__,
            QuestionImportAsset.__table__,
            QuestionImportRow.__table__,
        ],
    )

    try:
        yield engine

    finally:
        engine.dispose()


@pytest.fixture
def session(
    engine,
) -> Iterator[Session]:
    with Session(engine) as database_session:
        yield database_session


def create_user(
    session: Session,
) -> User:
    user = User(
        email=f"{uuid4()}@example.test",
        role=UserRole.CONTRIBUTOR,
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    return user


def create_batch(
    session: Session,
    *,
    uploader: User,
    digest: str | None = None,
) -> QuestionImportBatch:
    batch = QuestionImportBatch(
        uploaded_by_id=uploader.id,
        original_filename="questions.xlsx",
        file_type="xlsx",
        file_size_bytes=1024,
        file_sha256=digest or ("a" * 64),
        template_version="2.0",
    )
    session.add(batch)
    session.commit()
    session.refresh(batch)

    return batch


def test_import_batch_defaults_and_uploader_relationship(
    session: Session,
):
    uploader = create_user(session)

    batch = create_batch(
        session,
        uploader=uploader,
    )

    assert batch.status == "uploaded"
    assert batch.total_rows == 0
    assert batch.valid_rows == 0
    assert batch.error_rows == 0
    assert batch.warning_rows == 0
    assert batch.imported_rows == 0
    assert batch.uploaded_by_id == uploader.id
    assert batch.created_at is not None


def test_same_uploader_cannot_create_duplicate_file_hash(
    session: Session,
):
    uploader = create_user(session)

    create_batch(
        session,
        uploader=uploader,
        digest="b" * 64,
    )

    session.add(
        QuestionImportBatch(
            uploaded_by_id=uploader.id,
            original_filename="same-again.xlsx",
            file_type="xlsx",
            file_size_bytes=2048,
            file_sha256="b" * 64,
            template_version="2.0",
        )
    )

    with pytest.raises(IntegrityError):
        session.commit()

    session.rollback()


def test_different_uploaders_can_stage_same_file_hash(
    session: Session,
):
    first = create_user(session)
    second = create_user(session)

    first_batch = create_batch(
        session,
        uploader=first,
        digest="c" * 64,
    )
    second_batch = create_batch(
        session,
        uploader=second,
        digest="c" * 64,
    )

    assert first_batch.id != second_batch.id


def test_import_row_preserves_source_row_and_json_payload(
    session: Session,
):
    uploader = create_user(session)
    batch = create_batch(
        session,
        uploader=uploader,
    )

    row = QuestionImportRow(
        batch_id=batch.id,
        row_number=2,
        raw_payload={
            "question_text": "What is IAM?",
            "image_filename": "iam.png",
        },
    )

    session.add(row)
    session.commit()
    session.refresh(row)

    assert row.status == "pending"
    assert row.row_number == 2
    assert row.raw_payload["question_text"] == "What is IAM?"
    assert row.validation_issues == []


def test_import_row_number_is_unique_within_batch(
    session: Session,
):
    uploader = create_user(session)
    batch = create_batch(
        session,
        uploader=uploader,
    )

    session.add_all(
        [
            QuestionImportRow(
                batch_id=batch.id,
                row_number=2,
                raw_payload={"question_text": "First"},
            ),
            QuestionImportRow(
                batch_id=batch.id,
                row_number=2,
                raw_payload={"question_text": "Duplicate row"},
            ),
        ]
    )

    with pytest.raises(IntegrityError):
        session.commit()

    session.rollback()


def test_import_row_rejects_header_row_number(
    session: Session,
):
    uploader = create_user(session)
    batch = create_batch(
        session,
        uploader=uploader,
    )

    session.add(
        QuestionImportRow(
            batch_id=batch.id,
            row_number=1,
            raw_payload={"question_text": "Header"},
        )
    )

    with pytest.raises(IntegrityError):
        session.commit()

    session.rollback()


def test_asset_filename_is_case_normalized_by_caller_and_unique_per_batch(
    session: Session,
):
    uploader = create_user(session)
    batch = create_batch(
        session,
        uploader=uploader,
    )

    first = QuestionImportAsset(
        batch_id=batch.id,
        source_filename="VPC-Layout.PNG",
        normalized_filename="vpc-layout.png",
        byte_size=123,
    )

    session.add(first)
    session.commit()

    session.add(
        QuestionImportAsset(
            batch_id=batch.id,
            source_filename="vpc-layout.png",
            normalized_filename="vpc-layout.png",
            byte_size=456,
        )
    )

    with pytest.raises(IntegrityError):
        session.commit()

    session.rollback()


def test_multiple_rows_can_match_the_same_import_asset(
    session: Session,
):
    uploader = create_user(session)
    batch = create_batch(
        session,
        uploader=uploader,
    )

    asset = QuestionImportAsset(
        batch_id=batch.id,
        source_filename="shared.png",
        normalized_filename="shared.png",
        byte_size=512,
        sha256="d" * 64,
        media_type="image/png",
        status="valid",
    )
    session.add(asset)
    session.flush()

    first = QuestionImportRow(
        batch_id=batch.id,
        row_number=2,
        raw_payload={"image_filename": "shared.png"},
        matched_asset_id=asset.id,
    )
    second = QuestionImportRow(
        batch_id=batch.id,
        row_number=3,
        raw_payload={"image_filename": "shared.png"},
        matched_asset_id=asset.id,
    )

    session.add_all([first, second])
    session.commit()

    assert first.matched_asset_id == asset.id
    assert second.matched_asset_id == asset.id
