from collections.abc import Iterator
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from admin_auth_fixtures import domain_access_token, make_domain_user
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import (
    Session,
    SQLModel,
    create_engine,
    select,
)

from app.api.v1.endpoints import question_imports
from app.core.roles import UserRole
from app.db.session import get_session
from app.models.answer_option import AnswerOption
from app.models.category import Category
from app.models.certification import Certification
from app.models.question import Question
from app.models.question_image import QuestionImage
from app.models.question_import_asset import QuestionImportAsset
from app.models.question_import_batch import QuestionImportBatch
from app.models.question_import_row import QuestionImportRow
from app.models.question_version import QuestionVersion
from app.models.text_answer_key import TextAnswerKey
from app.models.user import User
from app.services.question_import_validation_service import (
    question_content_fingerprint,
)

app = FastAPI()

app.include_router(
    question_imports.router,
    prefix="/admin/question-imports",
)


@pytest.fixture
def engine():
    engine = create_engine(
        "sqlite://",
        connect_args={
            "check_same_thread": False,
        },
        poolclass=StaticPool,
    )

    @sa.event.listens_for(
        engine,
        "connect",
    )
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
            AnswerOption.__table__,
            TextAnswerKey.__table__,
            QuestionImage.__table__,
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


@pytest.fixture
def client(
    session: Session,
) -> Iterator[TestClient]:
    def override_session() -> Iterator[Session]:
        yield session

    app.dependency_overrides[get_session] = override_session

    try:
        with TestClient(app) as test_client:
            yield test_client

    finally:
        app.dependency_overrides.clear()


def create_user(
    session: Session,
    role: UserRole,
) -> User:
    user = make_domain_user(
        email=(f"{uuid4()}@example.test"),
        role=role,
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    return user


def auth_header(
    user: User,
) -> dict[str, str]:
    return {"Authorization": ("Bearer " + domain_access_token(user))}


def seed_catalog(
    session: Session,
):
    certification = Certification(
        name="AWS Cloud Practitioner",
        code="CLF-C02",
        is_published=True,
    )
    session.add(certification)
    session.flush()

    category = Category(
        certification_id=(certification.id),
        name="Security",
        is_published=True,
    )
    session.add(category)
    session.commit()

    return certification, category


def normalized_mc(
    *,
    certification: Certification,
    category: Category,
    question_text: str,
    image_filename: str | None = None,
    image_alt_text: str | None = None,
):
    return {
        "certification_id": str(certification.id),
        "category_id": str(category.id),
        "difficulty": "medium",
        "question_text": (question_text),
        "question_type": ("multiple_choice"),
        "allows_multiple_answers": False,
        "explanation": ("IAM manages access."),
        "options": [
            {
                "option_text": ("Identity service"),
                "is_correct": True,
            },
            {
                "option_text": ("Object storage"),
                "is_correct": False,
            },
        ],
        "expected_answer": None,
        "image_filename": (image_filename),
        "image_alt_text": (image_alt_text),
    }


def normalized_short_answer(
    *,
    certification: Certification,
    category: Category,
):
    return {
        "certification_id": str(certification.id),
        "category_id": str(category.id),
        "difficulty": "easy",
        "question_text": ("Expand IAM."),
        "question_type": ("short_answer"),
        "allows_multiple_answers": False,
        "explanation": ("IAM stands for Identity and Access Management."),
        "options": [],
        "expected_answer": ("Identity and Access Management"),
        "image_filename": None,
        "image_alt_text": None,
    }


def create_ready_batch(
    session: Session,
    *,
    uploader: User,
    rows: list[dict[str, object]],
    category: Category,
    certification: Certification,
    asset: QuestionImportAsset | None = None,
) -> QuestionImportBatch:
    batch = QuestionImportBatch(
        uploaded_by_id=(uploader.id),
        original_filename=("questions.xlsx"),
        file_type="xlsx",
        file_size_bytes=1024,
        file_sha256=(uuid4().hex * 2)[:64],
        template_version="2.0",
        status="ready",
        total_rows=len(rows),
        valid_rows=len(rows),
        error_rows=0,
        warning_rows=0,
    )
    session.add(batch)
    session.flush()

    for index, payload in enumerate(
        rows,
        start=2,
    ):
        fingerprint = question_content_fingerprint(
            certification_id=(certification.id),
            category_id=(category.id),
            question_type=str(payload["question_type"]),
            question_text=str(payload["question_text"]),
        )

        session.add(
            QuestionImportRow(
                batch_id=batch.id,
                row_number=index,
                raw_payload={},
                normalized_payload=payload,
                validation_issues=[],
                status="valid",
                content_fingerprint=(fingerprint),
                matched_asset_id=(
                    asset.id
                    if asset is not None and payload.get("image_filename")
                    else None
                ),
            )
        )

    session.commit()
    session.refresh(batch)

    return batch


def commit(
    client: TestClient,
    *,
    user: User,
    batch_id: UUID,
):
    return client.post(
        (f"/admin/question-imports/{batch_id}/commit"),
        headers=auth_header(user),
    )


def test_commit_creates_mcq_and_short_answer_atomically(
    client: TestClient,
    session: Session,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )
    certification, category = seed_catalog(session)

    batch = create_ready_batch(
        session,
        uploader=contributor,
        certification=certification,
        category=category,
        rows=[
            normalized_mc(
                certification=(certification),
                category=category,
                question_text=("What is IAM?"),
            ),
            normalized_short_answer(
                certification=(certification),
                category=category,
            ),
        ],
    )

    response = commit(
        client,
        user=contributor,
        batch_id=batch.id,
    )

    assert response.status_code == 200

    body = response.json()

    assert body["created_count"] == 2
    assert body["already_imported"] is False
    assert body["batch"]["status"] == "imported"
    assert body["batch"]["imported_rows"] == 2

    questions = session.exec(select(Question)).all()
    versions = session.exec(select(QuestionVersion)).all()

    assert len(questions) == 2
    assert len(versions) == 2

    assert all(question.created_by_id == contributor.id for question in questions)

    assert all(
        version.review_status == "pending"
        and version.publication_status == "draft"
        and version.version_number == 1
        for version in versions
    )

    assert len(session.exec(select(AnswerOption)).all()) == 2

    assert len(session.exec(select(TextAnswerKey)).all()) == 1

    rows = session.exec(
        select(QuestionImportRow).order_by(QuestionImportRow.row_number)
    ).all()

    assert all(row.status == "imported" for row in rows)

    assert all(
        row.created_question_id is not None
        and row.created_question_version_id is not None
        for row in rows
    )


def test_commit_attaches_staged_image_metadata(
    client: TestClient,
    session: Session,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )
    certification, category = seed_catalog(session)

    batch = QuestionImportBatch(
        uploaded_by_id=(contributor.id),
        original_filename=("questions.xlsx"),
        file_type="xlsx",
        file_size_bytes=1024,
        file_sha256="a" * 64,
        template_version="2.0",
        status="ready",
        total_rows=1,
        valid_rows=1,
    )
    session.add(batch)
    session.flush()

    asset = QuestionImportAsset(
        batch_id=batch.id,
        source_filename=("VPC.PNG"),
        normalized_filename=("vpc.png"),
        byte_size=123,
        sha256="b" * 64,
        media_type="image/png",
        temporary_storage_key=(f"imports/{batch.id}/asset.png"),
        status="valid",
    )
    session.add(asset)
    session.flush()

    payload = normalized_mc(
        certification=certification,
        category=category,
        question_text=("Which VPC diagram is correct?"),
        image_filename="VPC.PNG",
        image_alt_text=("VPC network diagram"),
    )

    session.add(
        QuestionImportRow(
            batch_id=batch.id,
            row_number=2,
            raw_payload={},
            normalized_payload=payload,
            validation_issues=[],
            status="valid",
            content_fingerprint=(
                question_content_fingerprint(
                    certification_id=(certification.id),
                    category_id=(category.id),
                    question_type=("multiple_choice"),
                    question_text=("Which VPC diagram is correct?"),
                )
            ),
            matched_asset_id=(asset.id),
        )
    )
    session.commit()

    response = commit(
        client,
        user=contributor,
        batch_id=batch.id,
    )

    assert response.status_code == 200

    image = session.exec(select(QuestionImage)).one()

    assert image.storage_key == asset.temporary_storage_key
    assert image.alt_text == "VPC network diagram"
    assert image.media_type == "image/png"

    session.refresh(asset)

    assert asset.status == "committed"
    assert asset.committed_at is not None


def test_shared_staged_asset_can_back_multiple_imported_questions(
    client: TestClient,
    session: Session,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )
    certification, category = seed_catalog(session)

    batch = QuestionImportBatch(
        uploaded_by_id=(contributor.id),
        original_filename=("questions.xlsx"),
        file_type="xlsx",
        file_size_bytes=1024,
        file_sha256="c" * 64,
        template_version="2.0",
        status="ready",
        total_rows=2,
        valid_rows=2,
    )
    session.add(batch)
    session.flush()

    asset = QuestionImportAsset(
        batch_id=batch.id,
        source_filename=("shared.png"),
        normalized_filename=("shared.png"),
        byte_size=123,
        sha256="d" * 64,
        media_type="image/png",
        temporary_storage_key=(f"imports/{batch.id}/shared.png"),
        status="valid",
    )
    session.add(asset)
    session.flush()

    for index, question_text in enumerate(
        [
            "First diagram question",
            "Second diagram question",
        ],
        start=2,
    ):
        payload = normalized_mc(
            certification=certification,
            category=category,
            question_text=(question_text),
            image_filename=("shared.png"),
            image_alt_text=("Shared diagram"),
        )

        session.add(
            QuestionImportRow(
                batch_id=batch.id,
                row_number=index,
                raw_payload={},
                normalized_payload=payload,
                validation_issues=[],
                status="valid",
                content_fingerprint=(
                    question_content_fingerprint(
                        certification_id=(certification.id),
                        category_id=(category.id),
                        question_type=("multiple_choice"),
                        question_text=(question_text),
                    )
                ),
                matched_asset_id=(asset.id),
            )
        )

    session.commit()

    response = commit(
        client,
        user=contributor,
        batch_id=batch.id,
    )

    assert response.status_code == 200

    images = session.exec(select(QuestionImage)).all()

    assert len(images) == 2
    assert {image.storage_key for image in images} == {asset.temporary_storage_key}


def test_repeated_commit_is_idempotent(
    client: TestClient,
    session: Session,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )
    certification, category = seed_catalog(session)

    batch = create_ready_batch(
        session,
        uploader=contributor,
        certification=certification,
        category=category,
        rows=[
            normalized_mc(
                certification=(certification),
                category=category,
                question_text=("Retry-safe question"),
            )
        ],
    )

    first = commit(
        client,
        user=contributor,
        batch_id=batch.id,
    )
    second = commit(
        client,
        user=contributor,
        batch_id=batch.id,
    )

    assert first.status_code == 200
    assert second.status_code == 200

    assert second.json()["already_imported"] is True

    assert second.json()["created_question_ids"] == first.json()["created_question_ids"]

    assert len(session.exec(select(Question)).all()) == 1


def test_not_ready_batch_cannot_commit(
    client: TestClient,
    session: Session,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )

    batch = QuestionImportBatch(
        uploaded_by_id=(contributor.id),
        original_filename=("questions.xlsx"),
        file_type="xlsx",
        file_size_bytes=1024,
        file_sha256="e" * 64,
        template_version="2.0",
        status="invalid",
        total_rows=1,
        valid_rows=0,
        error_rows=1,
    )
    session.add(batch)
    session.commit()

    response = commit(
        client,
        user=contributor,
        batch_id=batch.id,
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "IMPORT_NOT_READY"

    assert session.exec(select(Question)).all() == []


def test_stale_duplicate_is_rejected_before_any_new_question(
    client: TestClient,
    session: Session,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )
    certification, category = seed_catalog(session)

    batch = create_ready_batch(
        session,
        uploader=contributor,
        certification=certification,
        category=category,
        rows=[
            normalized_mc(
                certification=(certification),
                category=category,
                question_text=("Stale duplicate question"),
            )
        ],
    )

    existing = Question(
        certification_id=(certification.id),
        category_id=(category.id),
        difficulty="medium",
        created_by_id=(contributor.id),
    )
    session.add(existing)
    session.flush()

    session.add(
        QuestionVersion(
            question_id=existing.id,
            version_number=1,
            question_text=("Stale duplicate question"),
            question_type=("multiple_choice"),
            allows_multiple_answers=False,
            review_status="pending",
            publication_status="draft",
            submitted_by_id=(contributor.id),
        )
    )
    session.commit()

    response = commit(
        client,
        user=contributor,
        batch_id=batch.id,
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "IMPORT_STALE"

    assert len(session.exec(select(Question)).all()) == 1

    session.refresh(batch)
    assert batch.status == "ready"


def test_invalid_second_row_rolls_back_first_question(
    client: TestClient,
    session: Session,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )
    certification, category = seed_catalog(session)

    valid = normalized_mc(
        certification=certification,
        category=category,
        question_text=("First valid question"),
    )
    corrupt = normalized_mc(
        certification=certification,
        category=category,
        question_text=("Second corrupted question"),
    )
    corrupt["difficulty"] = "impossible"

    batch = create_ready_batch(
        session,
        uploader=contributor,
        certification=certification,
        category=category,
        rows=[
            valid,
            corrupt,
        ],
    )

    response = commit(
        client,
        user=contributor,
        batch_id=batch.id,
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "IMPORT_DATA_INVALID"

    assert session.exec(select(Question)).all() == []

    rows = session.exec(select(QuestionImportRow)).all()

    assert all(
        row.status == "valid" and row.created_question_id is None for row in rows
    )

    session.refresh(batch)
    assert batch.status == "ready"
    assert batch.imported_rows == 0


def test_contributor_cannot_commit_foreign_batch(
    client: TestClient,
    session: Session,
):
    owner = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )
    other = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )
    certification, category = seed_catalog(session)

    batch = create_ready_batch(
        session,
        uploader=owner,
        certification=certification,
        category=category,
        rows=[
            normalized_mc(
                certification=(certification),
                category=category,
                question_text=("Owner-only question"),
            )
        ],
    )

    response = commit(
        client,
        user=other,
        batch_id=batch.id,
    )

    assert response.status_code == 404
    assert session.exec(select(Question)).all() == []


def test_admin_commit_preserves_original_uploader_as_owner(
    client: TestClient,
    session: Session,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )
    administrator = create_user(
        session,
        UserRole.ADMINISTRATOR,
    )
    certification, category = seed_catalog(session)

    batch = create_ready_batch(
        session,
        uploader=contributor,
        certification=certification,
        category=category,
        rows=[
            normalized_mc(
                certification=(certification),
                category=category,
                question_text=("Admin-confirmed contributor question"),
            )
        ],
    )

    response = commit(
        client,
        user=administrator,
        batch_id=batch.id,
    )

    assert response.status_code == 200

    question = session.exec(select(Question)).one()

    assert question.created_by_id == contributor.id
