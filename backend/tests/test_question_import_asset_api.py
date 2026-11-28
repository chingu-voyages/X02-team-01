from collections.abc import Iterator
from io import BytesIO
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from admin_auth_fixtures import domain_access_token, make_domain_user
from fastapi import FastAPI
from fastapi.testclient import TestClient
from openpyxl import Workbook
from PIL import Image
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
from app.models.category import Category
from app.models.certification import Certification
from app.models.question import Question
from app.models.question_import_asset import QuestionImportAsset
from app.models.question_import_batch import QuestionImportBatch
from app.models.question_import_row import QuestionImportRow
from app.models.question_version import QuestionVersion
from app.models.user import User
from app.services.question_import_parser import QUESTION_IMPORT_HEADERS
from app.services.r2_storage import R2StorageError


class FakeStorage:
    def __init__(
        self,
        *,
        fail_upload: bool = False,
    ) -> None:
        self.fail_upload = fail_upload
        self.uploads: list[dict[str, object]] = []
        self.deletes: list[str] = []

    def upload(
        self,
        *,
        key: str,
        content: bytes,
        media_type: str,
    ) -> None:
        if self.fail_upload:
            raise R2StorageError("Unable to upload question image")

        self.uploads.append(
            {
                "key": key,
                "content": content,
                "media_type": media_type,
            }
        )

    def delete(
        self,
        *,
        key: str,
    ) -> None:
        self.deletes.append(key)


app = FastAPI()

app.include_router(
    question_imports.router,
    prefix="/admin/question-imports",
)


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

    for (
        column,
        header,
    ) in enumerate(
        QUESTION_IMPORT_HEADERS,
        start=1,
    ):
        worksheet.cell(
            row=1,
            column=column,
            value=header,
        )

    for (
        row_number,
        values,
    ) in enumerate(
        rows,
        start=2,
    ):
        for (
            column,
            header,
        ) in enumerate(
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


def image_bytes(
    image_format: str = "PNG",
    *,
    color: str = "white",
) -> bytes:
    output = BytesIO()

    mode = (
        "RGB"
        if image_format
        in {
            "JPEG",
            "WEBP",
        }
        else "RGBA"
    )

    Image.new(
        mode,
        (8, 8),
        color=color,
    ).save(
        output,
        format=image_format,
    )

    return output.getvalue()


def row_with_image(
    *,
    image_filename: str = "vpc.png",
) -> dict[str, object]:
    return {
        "template_version": "2.0",
        "certification_code": "CLF-C02",
        "category_name": "Security",
        "difficulty": "medium",
        "question_type": "multiple_choice",
        "allows_multiple_answers": False,
        "question_text": "Which network diagram is correct?",
        "option_a": "Diagram A",
        "option_b": "Diagram B",
        "option_c": None,
        "option_d": None,
        "option_e": None,
        "option_f": None,
        "correct_answers": "A",
        "expected_answer": None,
        "explanation": "Review the VPC layout.",
        "image_filename": image_filename,
        "image_alt_text": "VPC network diagram",
    }


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
def storage() -> FakeStorage:
    return FakeStorage()


@pytest.fixture
def client(
    session: Session,
    storage: FakeStorage,
) -> Iterator[TestClient]:
    def override_session() -> Iterator[Session]:
        yield session

    def override_storage() -> FakeStorage:
        return storage

    app.dependency_overrides[get_session] = override_session

    app.dependency_overrides[question_imports.get_import_r2_storage] = override_storage

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
) -> None:
    certification = Certification(
        name="AWS Cloud Practitioner",
        code="CLF-C02",
        is_published=True,
    )
    session.add(certification)
    session.flush()

    session.add(
        Category(
            certification_id=(certification.id),
            name="Security",
            is_published=True,
        )
    )
    session.commit()


def create_image_batch(
    client: TestClient,
    *,
    contributor: User,
    image_filename: str = "vpc.png",
) -> str:
    response = client.post(
        "/admin/question-imports",
        headers=auth_header(contributor),
        files={
            "file": (
                "questions.xlsx",
                workbook_bytes([row_with_image(image_filename=(image_filename))]),
                ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            )
        },
    )

    assert response.status_code == 201
    assert response.json()["status"] == "invalid"
    assert response.json()["can_import"] is False

    return response.json()["id"]


def upload_asset(
    client: TestClient,
    *,
    user: User,
    batch_id: str,
    filename: str,
    content: bytes,
):
    return client.post(
        (f"/admin/question-imports/{batch_id}/assets"),
        headers=auth_header(user),
        files={
            "file": (
                filename,
                content,
                "application/octet-stream",
            )
        },
    )


def test_valid_asset_upload_revalidates_batch_to_ready(
    client: TestClient,
    session: Session,
    storage: FakeStorage,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )
    seed_catalog(session)

    batch_id = create_image_batch(
        client,
        contributor=contributor,
        image_filename="VPC.PNG",
    )

    response = upload_asset(
        client,
        user=contributor,
        batch_id=batch_id,
        filename="vpc.png",
        content=image_bytes(),
    )

    assert response.status_code == 201

    body = response.json()

    assert body["asset"]["source_filename"] == "vpc.png"
    assert body["asset"]["media_type"] == "image/png"
    assert body["asset"]["status"] == "valid"
    assert "temporary_storage_key" not in body["asset"]

    assert body["batch"]["status"] == "ready"
    assert body["batch"]["error_rows"] == 0
    assert body["batch"]["can_import"] is True

    assert len(storage.uploads) == 1
    assert str(storage.uploads[0]["key"]).startswith(f"imports/{batch_id}/")

    asset = session.exec(select(QuestionImportAsset)).one()

    row = session.exec(select(QuestionImportRow)).one()

    assert row.status == "valid"
    assert row.matched_asset_id == asset.id
    assert "MISSING_IMAGE_FILE" not in {
        issue["code"] for issue in row.validation_issues
    }


def test_identical_asset_reupload_is_idempotent(
    client: TestClient,
    session: Session,
    storage: FakeStorage,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )
    seed_catalog(session)

    batch_id = create_image_batch(
        client,
        contributor=contributor,
    )

    content = image_bytes()

    first = upload_asset(
        client,
        user=contributor,
        batch_id=batch_id,
        filename="vpc.png",
        content=content,
    )
    second = upload_asset(
        client,
        user=contributor,
        batch_id=batch_id,
        filename="VPC.PNG",
        content=content,
    )

    assert first.status_code == 201
    assert second.status_code == 200

    assert first.json()["asset"]["id"] == second.json()["asset"]["id"]

    assert len(storage.uploads) == 1

    assets = session.exec(select(QuestionImportAsset)).all()

    assert len(assets) == 1


def test_same_normalized_filename_with_different_bytes_conflicts(
    client: TestClient,
    session: Session,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )
    seed_catalog(session)

    batch_id = create_image_batch(
        client,
        contributor=contributor,
    )

    first = upload_asset(
        client,
        user=contributor,
        batch_id=batch_id,
        filename="vpc.png",
        content=image_bytes(color="white"),
    )
    second = upload_asset(
        client,
        user=contributor,
        batch_id=batch_id,
        filename="VPC.PNG",
        content=image_bytes(color="black"),
    )

    assert first.status_code == 201
    assert second.status_code == 409


def test_invalid_image_bytes_are_rejected_without_asset_record(
    client: TestClient,
    session: Session,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )
    seed_catalog(session)

    batch_id = create_image_batch(
        client,
        contributor=contributor,
    )

    response = upload_asset(
        client,
        user=contributor,
        batch_id=batch_id,
        filename="vpc.gif",
        content=b"GIF89a-not-supported",
    )

    assert response.status_code == 415

    assert session.exec(select(QuestionImportAsset)).all() == []


def test_asset_filename_paths_are_rejected(
    client: TestClient,
    session: Session,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )
    seed_catalog(session)

    batch_id = create_image_batch(
        client,
        contributor=contributor,
    )

    response = upload_asset(
        client,
        user=contributor,
        batch_id=batch_id,
        filename="images/vpc.png",
        content=image_bytes(),
    )

    assert response.status_code == 422


def test_contributor_cannot_add_asset_to_foreign_batch(
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
    seed_catalog(session)

    batch_id = create_image_batch(
        client,
        contributor=owner,
    )

    response = upload_asset(
        client,
        user=other,
        batch_id=batch_id,
        filename="vpc.png",
        content=image_bytes(),
    )

    assert response.status_code == 404


def test_committed_batch_rejects_new_assets(
    client: TestClient,
    session: Session,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )
    seed_catalog(session)

    batch_id = create_image_batch(
        client,
        contributor=contributor,
    )

    batch = session.get(
        QuestionImportBatch,
        UUID(batch_id),
    )
    assert batch is not None

    batch.status = "imported"
    session.add(batch)
    session.commit()

    response = upload_asset(
        client,
        user=contributor,
        batch_id=batch_id,
        filename="vpc.png",
        content=image_bytes(),
    )

    assert response.status_code == 409


def test_r2_upload_failure_rolls_back_asset_record(
    session: Session,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )
    seed_catalog(session)

    failing_storage = FakeStorage(fail_upload=True)

    def override_session() -> Iterator[Session]:
        yield session

    def override_storage() -> FakeStorage:
        return failing_storage

    app.dependency_overrides[get_session] = override_session

    app.dependency_overrides[question_imports.get_import_r2_storage] = override_storage

    try:
        with TestClient(app) as test_client:
            batch_id = create_image_batch(
                test_client,
                contributor=contributor,
            )

            response = upload_asset(
                test_client,
                user=contributor,
                batch_id=batch_id,
                filename="vpc.png",
                content=image_bytes(),
            )

            assert response.status_code == 503

            assert session.exec(select(QuestionImportAsset)).all() == []

    finally:
        app.dependency_overrides.clear()
