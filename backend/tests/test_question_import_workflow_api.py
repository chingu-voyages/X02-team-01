from collections.abc import Iterator
from io import BytesIO
from uuid import UUID, uuid4

import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from openpyxl import Workbook
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.api.v1.endpoints import (
    question_import_actions,
    question_imports,
)
from app.core.roles import UserRole
from app.core.security import create_access_token
from app.db.session import get_session
from app.models.category import Category
from app.models.certification import Certification
from app.models.question import Question
from app.models.question_import_asset import QuestionImportAsset
from app.models.question_import_batch import QuestionImportBatch
from app.models.question_import_row import QuestionImportRow
from app.models.question_version import QuestionVersion
from app.models.user import User
from app.services.question_import_parser import QUESTION_IMPORT_HEADERS

app = FastAPI()
app.include_router(
    question_imports.router,
    prefix="/admin/question-imports",
)
app.include_router(
    question_import_actions.router,
    prefix="/admin/question-imports",
)


class FakeStorage:
    def __init__(self) -> None:
        self.deleted: list[str] = []

    def delete(
        self,
        *,
        key: str,
    ) -> None:
        self.deleted.append(key)


def workbook_bytes(
    rows: list[dict[str, object]],
) -> bytes:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "Questions"

    for name in [
        "Read Me",
        "Examples",
        "Field Guide",
        "Sources",
    ]:
        workbook.create_sheet(name)

    for column, header in enumerate(
        QUESTION_IMPORT_HEADERS,
        start=1,
    ):
        worksheet.cell(
            row=1,
            column=column,
            value=header,
        )

    for row_number, values in enumerate(
        rows,
        start=2,
    ):
        for column, header in enumerate(
            QUESTION_IMPORT_HEADERS,
            start=1,
        ):
            worksheet.cell(
                row=row_number,
                column=column,
                value=values.get(header),
            )

    output = BytesIO()
    workbook.save(output)
    workbook.close()

    return output.getvalue()


def valid_row(
    *,
    certification_code: str = "CLF-C02",
) -> dict[str, object]:
    return {
        "template_version": "2.0",
        "certification_code": certification_code,
        "category_name": "Security",
        "difficulty": "medium",
        "question_type": "multiple_choice",
        "allows_multiple_answers": False,
        "question_text": "What is IAM?",
        "option_a": "Identity service",
        "option_b": "Object storage",
        "option_c": None,
        "option_d": None,
        "option_e": None,
        "option_f": None,
        "correct_answers": "A",
        "expected_answer": None,
        "explanation": "IAM manages identity and access.",
        "image_filename": None,
        "image_alt_text": None,
    }


def create_user(
    session: Session,
    role: UserRole,
) -> User:
    user = User(
        email=f"{uuid4()}@example.test",
        role=role,
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    return user


def auth_header(
    user: User,
) -> dict[str, str]:
    return {
        "Authorization": (
            "Bearer "
            + create_access_token(
                str(user.id),
            )
        ),
    }


def seed_catalog(
    session: Session,
    *,
    code: str = "CLF-C02",
) -> tuple[Certification, Category]:
    certification = Certification(
        name="Example Certification",
        code=code,
        is_published=True,
    )
    session.add(certification)
    session.flush()

    category = Category(
        certification_id=certification.id,
        name="Security",
        is_published=True,
    )
    session.add(category)
    session.commit()

    return certification, category


def upload(
    client: TestClient,
    *,
    user: User,
    content: bytes,
):
    return client.post(
        "/admin/question-imports",
        headers=auth_header(user),
        files={
            "file": (
                "questions.xlsx",
                content,
                ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            ),
        },
    )


def create_batch(
    session: Session,
    *,
    owner: User,
    status: str,
) -> QuestionImportBatch:
    batch = QuestionImportBatch(
        uploaded_by_id=owner.id,
        original_filename="questions.xlsx",
        file_type="xlsx",
        file_size_bytes=100,
        file_sha256=uuid4().hex + uuid4().hex,
        template_version="2.0",
        status=status,
        total_rows=1,
        valid_rows=0,
        error_rows=1,
        warning_rows=0,
        imported_rows=(1 if status == "imported" else 0),
    )
    session.add(batch)
    session.commit()
    session.refresh(batch)

    return batch


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


def test_cancel_revalidate_and_reactivate_workflow():
    engine = build_engine()
    fake_storage = FakeStorage()

    try:
        with Session(engine) as session:

            def override_session() -> Iterator[Session]:
                yield session

            app.dependency_overrides[get_session] = override_session
            app.dependency_overrides[
                question_import_actions.get_optional_import_r2_storage
            ] = lambda: fake_storage

            with TestClient(app) as client:
                contributor = create_user(
                    session,
                    UserRole.CONTRIBUTOR,
                )

                # 1. Invalid batch can be revalidated after the catalog changes.
                content = workbook_bytes(
                    [
                        valid_row(
                            certification_code="CS-DEMO",
                        ),
                    ]
                )

                created = upload(
                    client,
                    user=contributor,
                    content=content,
                )

                assert created.status_code == 201
                assert created.json()["status"] == "invalid"

                seed_catalog(
                    session,
                    code="CS-DEMO",
                )

                revalidated = client.post(
                    (f"/admin/question-imports/{created.json()['id']}/revalidate"),
                    headers=auth_header(contributor),
                )

                assert revalidated.status_code == 200
                assert revalidated.json()["status"] == "ready"
                assert revalidated.json()["can_import"] is True

                # 2. Cancelling discards temporary R2 assets.
                batch = session.get(
                    QuestionImportBatch,
                    UUID(created.json()["id"]),
                )
                assert batch is not None

                asset = QuestionImportAsset(
                    batch_id=batch.id,
                    source_filename="diagram.png",
                    normalized_filename="diagram.png",
                    byte_size=100,
                    sha256=uuid4().hex + uuid4().hex,
                    media_type="image/png",
                    temporary_storage_key=(f"imports/{batch.id}/diagram.png"),
                    status="valid",
                )
                session.add(asset)
                session.commit()

                cancelled = client.post(
                    (f"/admin/question-imports/{batch.id}/cancel"),
                    headers=auth_header(contributor),
                )

                assert cancelled.status_code == 200
                assert cancelled.json()["batch"]["status"] == "cancelled"
                assert cancelled.json()["discarded_asset_count"] == 1
                assert cancelled.json()["already_cancelled"] is False

                session.refresh(asset)

                assert asset.status == "discarded"
                assert asset.temporary_storage_key is None
                assert fake_storage.deleted == [f"imports/{batch.id}/diagram.png"]
                assert session.exec(select(Question)).all() == []

                repeated_cancel = client.post(
                    (f"/admin/question-imports/{batch.id}/cancel"),
                    headers=auth_header(contributor),
                )

                assert repeated_cancel.status_code == 200
                assert repeated_cancel.json()["already_cancelled"] is True

                # 3. Re-uploading the identical cancelled workbook
                # reactivates the existing batch instead of leaving it stuck.
                repeated_upload = upload(
                    client,
                    user=contributor,
                    content=content,
                )

                assert repeated_upload.status_code == 200
                assert repeated_upload.json()["id"] == str(batch.id)
                assert repeated_upload.json()["status"] == "ready"

    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def test_permissions_and_imported_state_are_enforced():
    engine = build_engine()
    fake_storage = FakeStorage()

    try:
        with Session(engine) as session:

            def override_session() -> Iterator[Session]:
                yield session

            app.dependency_overrides[get_session] = override_session
            app.dependency_overrides[
                question_import_actions.get_optional_import_r2_storage
            ] = lambda: fake_storage

            with TestClient(app) as client:
                owner = create_user(
                    session,
                    UserRole.CONTRIBUTOR,
                )
                other = create_user(
                    session,
                    UserRole.CONTRIBUTOR,
                )

                invalid_batch = create_batch(
                    session,
                    owner=owner,
                    status="invalid",
                )

                hidden = client.post(
                    (f"/admin/question-imports/{invalid_batch.id}/cancel"),
                    headers=auth_header(other),
                )

                assert hidden.status_code == 404

                imported_batch = create_batch(
                    session,
                    owner=owner,
                    status="imported",
                )

                conflict = client.post(
                    (f"/admin/question-imports/{imported_batch.id}/cancel"),
                    headers=auth_header(owner),
                )

                assert conflict.status_code == 409
                assert conflict.json()["detail"]["code"] == "IMPORT_CANNOT_BE_CANCELLED"

    finally:
        app.dependency_overrides.clear()
        engine.dispose()
