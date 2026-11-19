from collections.abc import Iterator
from io import BytesIO
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from openpyxl import Workbook
from sqlalchemy.pool import StaticPool
from sqlmodel import (
    Session,
    SQLModel,
    create_engine,
    select,
)

from app.api.v1.endpoints import question_imports
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


def workbook_bytes(
    rows: list[dict[str, object]],
    *,
    headers: tuple[str, ...] = QUESTION_IMPORT_HEADERS,
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
        headers,
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
            headers,
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
    question_text: str = "What is IAM?",
    image_filename: str | None = None,
    image_alt_text: str | None = None,
) -> dict[str, object]:
    return {
        "template_version": "2.0",
        "certification_code": "CLF-C02",
        "category_name": "Security",
        "difficulty": "medium",
        "question_type": "multiple_choice",
        "allows_multiple_answers": False,
        "question_text": question_text,
        "option_a": "Identity service",
        "option_b": "Object storage",
        "option_c": None,
        "option_d": None,
        "option_e": None,
        "option_f": None,
        "correct_answers": "A",
        "expected_answer": None,
        "explanation": "IAM manages identity and access.",
        "image_filename": image_filename,
        "image_alt_text": image_alt_text,
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
    token = create_access_token(str(user.id))

    return {"Authorization": f"Bearer {token}"}


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
            certification_id=certification.id,
            name="Security",
            is_published=True,
        )
    )
    session.commit()


def upload(
    client: TestClient,
    *,
    user: User,
    content: bytes,
    filename: str = "questions.xlsx",
):
    return client.post(
        "/admin/question-imports",
        headers=auth_header(user),
        files={
            "file": (
                filename,
                content,
                ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            )
        },
    )


def test_contributor_uploads_and_validates_clean_workbook(
    client: TestClient,
    session: Session,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )
    seed_catalog(session)

    response = upload(
        client,
        user=contributor,
        content=workbook_bytes([valid_row()]),
    )

    assert response.status_code == 201

    body = response.json()

    assert body["status"] == "ready"
    assert body["total_rows"] == 1
    assert body["valid_rows"] == 1
    assert body["error_rows"] == 0
    assert body["can_import"] is True

    assert session.exec(select(Question)).all() == []

    batch = session.get(
        QuestionImportBatch,
        UUID(body["id"]),
    )
    assert batch is not None

    rows = session.exec(select(QuestionImportRow)).all()
    assert len(rows) == 1
    assert rows[0].row_number == 2
    assert rows[0].status == "valid"


def test_learner_cannot_upload_question_import(
    client: TestClient,
    session: Session,
):
    learner = create_user(
        session,
        UserRole.LEARNER,
    )

    response = upload(
        client,
        user=learner,
        content=workbook_bytes([valid_row()]),
    )

    assert response.status_code == 403


def test_structurally_invalid_workbook_is_rejected_without_batch(
    client: TestClient,
    session: Session,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )

    missing_header = tuple(
        header for header in QUESTION_IMPORT_HEADERS if header != "image_alt_text"
    )

    response = upload(
        client,
        user=contributor,
        content=workbook_bytes(
            [valid_row()],
            headers=missing_header,
        ),
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "MISSING_HEADER"

    assert session.exec(select(QuestionImportBatch)).all() == []


def test_row_validation_errors_persist_as_preview_not_partial_questions(
    client: TestClient,
    session: Session,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )
    seed_catalog(session)

    row = valid_row()
    row["certification_code"] = "UNKNOWN"

    response = upload(
        client,
        user=contributor,
        content=workbook_bytes([row]),
    )

    assert response.status_code == 201

    body = response.json()

    assert body["status"] == "invalid"
    assert body["error_rows"] == 1
    assert body["can_import"] is False

    assert session.exec(select(Question)).all() == []

    rows_response = client.get(
        (f"/admin/question-imports/{body['id']}/rows?row_status=invalid"),
        headers=auth_header(contributor),
    )

    assert rows_response.status_code == 200

    rows_body = rows_response.json()

    assert rows_body["total"] == 1
    assert rows_body["items"][0]["issues"][0]["code"] == "CERTIFICATION_NOT_FOUND"


def test_identical_reupload_returns_existing_batch(
    client: TestClient,
    session: Session,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )
    seed_catalog(session)

    content = workbook_bytes([valid_row()])

    first = upload(
        client,
        user=contributor,
        content=content,
    )
    second = upload(
        client,
        user=contributor,
        content=content,
    )

    assert first.status_code == 201
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]

    batches = session.exec(select(QuestionImportBatch)).all()

    assert len(batches) == 1


def test_contributor_cannot_probe_another_contributors_batch(
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

    created = upload(
        client,
        user=owner,
        content=workbook_bytes([valid_row()]),
    )

    response = client.get(
        (f"/admin/question-imports/{created.json()['id']}"),
        headers=auth_header(other),
    )

    assert response.status_code == 404


def test_administrator_can_view_contributor_batch(
    client: TestClient,
    session: Session,
):
    owner = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )
    administrator = create_user(
        session,
        UserRole.ADMINISTRATOR,
    )
    seed_catalog(session)

    created = upload(
        client,
        user=owner,
        content=workbook_bytes([valid_row()]),
    )

    response = client.get(
        (f"/admin/question-imports/{created.json()['id']}"),
        headers=auth_header(administrator),
    )

    assert response.status_code == 200
    assert response.json()["id"] == created.json()["id"]


def test_preview_rows_are_server_paginated(
    client: TestClient,
    session: Session,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )
    seed_catalog(session)

    created = upload(
        client,
        user=contributor,
        content=workbook_bytes(
            [valid_row(question_text=f"Question {index}") for index in range(3)]
        ),
    )

    batch_id = created.json()["id"]

    first = client.get(
        (f"/admin/question-imports/{batch_id}/rows?page=1&page_size=2"),
        headers=auth_header(contributor),
    )
    second = client.get(
        (f"/admin/question-imports/{batch_id}/rows?page=2&page_size=2"),
        headers=auth_header(contributor),
    )

    assert first.status_code == 200
    assert second.status_code == 200

    assert first.json()["total"] == 3
    assert len(first.json()["items"]) == 2
    assert len(second.json()["items"]) == 1


def test_missing_image_reference_is_visible_in_row_preview(
    client: TestClient,
    session: Session,
):
    contributor = create_user(
        session,
        UserRole.CONTRIBUTOR,
    )
    seed_catalog(session)

    created = upload(
        client,
        user=contributor,
        content=workbook_bytes(
            [
                valid_row(
                    image_filename="vpc.png",
                    image_alt_text="VPC diagram",
                )
            ]
        ),
    )

    assert created.status_code == 201
    assert created.json()["status"] == "invalid"

    rows = client.get(
        (f"/admin/question-imports/{created.json()['id']}/rows"),
        headers=auth_header(contributor),
    )

    assert rows.status_code == 200

    codes = {issue["code"] for issue in rows.json()["items"][0]["issues"]}

    assert "MISSING_IMAGE_FILE" in codes
