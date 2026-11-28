from collections.abc import Iterator
from datetime import UTC, datetime
from uuid import uuid4

import sqlalchemy as sa
from admin_auth_fixtures import domain_access_token, make_domain_user
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.api.v1.endpoints import question_import_actions
from app.core.roles import UserRole
from app.db.session import get_session
from app.models.category import Category
from app.models.certification import Certification
from app.models.question import Question
from app.models.question_import_asset import QuestionImportAsset
from app.models.question_import_batch import QuestionImportBatch
from app.models.question_import_row import QuestionImportRow
from app.models.question_version import QuestionVersion
from app.models.user import User

app = FastAPI()
app.include_router(
    question_import_actions.router,
    prefix="/admin/question-imports",
)


def create_user(
    session: Session,
    role: UserRole,
) -> User:
    user = make_domain_user(
        email=f"{uuid4()}@example.test",
        role=role,
        is_verified=True,
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    return user


def auth_header(
    user: User,
) -> dict[str, str]:
    return {
        "Authorization": ("Bearer " + domain_access_token(user)),
    }


def seed_catalog(
    session: Session,
) -> tuple[
    Certification,
    Category,
]:
    certification = Certification(
        code=f"TEST-{uuid4().hex[:8]}",
        name="Bulk Publish Test",
        is_published=True,
    )
    session.add(certification)
    session.flush()

    category = Category(
        certification_id=certification.id,
        name="Fundamentals",
        is_published=True,
    )
    session.add(category)
    session.commit()

    return (
        certification,
        category,
    )


def seed_imported_batch(
    session: Session,
    *,
    owner: User,
    question_count: int = 2,
) -> tuple[
    QuestionImportBatch,
    list[QuestionVersion],
]:
    certification, category = seed_catalog(
        session,
    )

    batch = QuestionImportBatch(
        uploaded_by_id=owner.id,
        original_filename="questions.xlsx",
        file_type="xlsx",
        file_size_bytes=100,
        file_sha256=(uuid4().hex + uuid4().hex),
        template_version="2.0",
        status="imported",
        total_rows=question_count,
        valid_rows=question_count,
        error_rows=0,
        warning_rows=0,
        imported_rows=question_count,
        validated_at=datetime.now(UTC),
        imported_at=datetime.now(UTC),
    )
    session.add(batch)
    session.flush()

    versions: list[QuestionVersion] = []

    for index in range(question_count):
        question = Question(
            certification_id=certification.id,
            category_id=category.id,
            difficulty="easy",
            created_by_id=owner.id,
        )
        session.add(question)
        session.flush()

        version = QuestionVersion(
            question_id=question.id,
            version_number=1,
            question_text=(f"Imported question {index + 1}"),
            question_type="multiple_choice",
            allows_multiple_answers=False,
            review_status="pending",
            publication_status="draft",
            submitted_by_id=owner.id,
        )
        session.add(version)
        session.flush()

        row = QuestionImportRow(
            batch_id=batch.id,
            row_number=index + 2,
            raw_payload={},
            normalized_payload={},
            validation_issues=[],
            status="imported",
            created_question_id=question.id,
            created_question_version_id=version.id,
            imported_at=datetime.now(UTC),
        )
        session.add(row)
        versions.append(version)

    session.commit()

    for version in versions:
        session.refresh(version)

    session.refresh(batch)

    return (
        batch,
        versions,
    )


def build_engine():
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
        cursor.execute(
            "PRAGMA foreign_keys=ON",
        )
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

    return engine


def client_context(
    session: Session,
) -> TestClient:
    def override_session() -> Iterator[Session]:
        yield session

    app.dependency_overrides[get_session] = override_session

    return TestClient(app)


def test_administrator_publishes_entire_import_atomically():
    engine = build_engine()

    try:
        with Session(engine) as session:
            owner = create_user(
                session,
                UserRole.CONTRIBUTOR,
            )
            administrator = create_user(
                session,
                UserRole.ADMINISTRATOR,
            )
            batch, versions = seed_imported_batch(
                session,
                owner=owner,
            )

            with client_context(session) as client:
                response = client.post(
                    (f"/admin/question-imports/{batch.id}/publish"),
                    headers=auth_header(administrator),
                )

                assert response.status_code == 200

                body = response.json()

                assert body["requested_count"] == 2
                assert body["published_count"] == 2
                assert body["already_published_count"] == 0
                assert body["all_published"] is True
                assert len(body["published_question_ids"]) == 2

                for version in versions:
                    session.refresh(version)

                    assert version.review_status == "approved"
                    assert version.publication_status == "active"
                    assert version.reviewed_by_id == administrator.id
                    assert version.reviewed_at is not None
                    assert version.review_note is None

                repeated = client.post(
                    (f"/admin/question-imports/{batch.id}/publish"),
                    headers=auth_header(administrator),
                )

                assert repeated.status_code == 200

                repeated_body = repeated.json()

                assert repeated_body["published_count"] == 0
                assert repeated_body["already_published_count"] == 2
                assert repeated_body["all_published"] is True

                version_rows = session.exec(select(QuestionVersion)).all()

                assert len(version_rows) == 2

    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def test_contributor_cannot_bulk_publish_import():
    engine = build_engine()

    try:
        with Session(engine) as session:
            contributor = create_user(
                session,
                UserRole.CONTRIBUTOR,
            )
            batch, versions = seed_imported_batch(
                session,
                owner=contributor,
            )

            with client_context(session) as client:
                response = client.post(
                    (f"/admin/question-imports/{batch.id}/publish"),
                    headers=auth_header(contributor),
                )

                assert response.status_code == 403

                for version in versions:
                    session.refresh(version)

                    assert version.review_status == "pending"
                    assert version.publication_status == "draft"

    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def test_uncommitted_batch_cannot_be_bulk_published():
    engine = build_engine()

    try:
        with Session(engine) as session:
            contributor = create_user(
                session,
                UserRole.CONTRIBUTOR,
            )
            administrator = create_user(
                session,
                UserRole.ADMINISTRATOR,
            )

            batch = QuestionImportBatch(
                uploaded_by_id=contributor.id,
                original_filename="questions.xlsx",
                file_type="xlsx",
                file_size_bytes=100,
                file_sha256=(uuid4().hex + uuid4().hex),
                template_version="2.0",
                status="ready",
                total_rows=1,
                valid_rows=1,
                error_rows=0,
                warning_rows=0,
                imported_rows=0,
            )
            session.add(batch)
            session.commit()

            with client_context(session) as client:
                response = client.post(
                    (f"/admin/question-imports/{batch.id}/publish"),
                    headers=auth_header(administrator),
                )

                assert response.status_code == 409
                assert response.json()["detail"]["code"] == "IMPORT_BATCH_NOT_IMPORTED"

    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def test_one_ineligible_question_blocks_entire_batch():
    engine = build_engine()

    try:
        with Session(engine) as session:
            contributor = create_user(
                session,
                UserRole.CONTRIBUTOR,
            )
            administrator = create_user(
                session,
                UserRole.ADMINISTRATOR,
            )
            batch, versions = seed_imported_batch(
                session,
                owner=contributor,
            )

            administrator_id = administrator.id

            blocked = versions[1]

            # Set required review metadata before changing the review state.
            blocked.reviewed_by_id = administrator_id
            blocked.reviewed_at = datetime.now(UTC)
            blocked.review_note = "Needs correction before publishing."
            blocked.review_status = "rejected"

            session.add(blocked)
            session.commit()

            with client_context(session) as client:
                response = client.post(
                    (f"/admin/question-imports/{batch.id}/publish"),
                    headers=auth_header(administrator),
                )

                assert response.status_code == 409
                assert response.json()["detail"]["code"] == (
                    "IMPORT_QUESTIONS_NOT_PUBLISHABLE"
                )

                session.refresh(versions[0])
                session.refresh(versions[1])

                assert versions[0].review_status == "pending"
                assert versions[0].publication_status == "draft"
                assert versions[1].review_status == "rejected"
                assert versions[1].publication_status == "draft"

    finally:
        app.dependency_overrides.clear()
        engine.dispose()
