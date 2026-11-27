"""JHEP-207: preview is read-only; only explicit confirmation creates catalog records."""

from collections.abc import Iterator
from io import BytesIO
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from openpyxl import Workbook
from sqlalchemy import event
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.api.v1.endpoints import (
    question_import_actions,
    question_import_catalog,
    question_imports,
)
from app.core.roles import UserRole
from app.core.security import create_access_token
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
from app.schemas.admin_category import CategoryCreate
from app.services.admin_category_service import create_category
from app.services.question_import_parser import QUESTION_IMPORT_HEADERS

BASE = "/admin/question-imports"


@pytest.fixture
def environment() -> Iterator[tuple[TestClient, Session]]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _record):
        connection.execute("PRAGMA foreign_keys=ON")

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
    app = FastAPI()
    app.include_router(question_imports.router, prefix=BASE)
    app.include_router(question_import_actions.router, prefix=BASE)
    app.include_router(question_import_catalog.router, prefix=BASE)
    try:
        with Session(engine) as session:

            def override_session() -> Iterator[Session]:
                yield session

            app.dependency_overrides[get_session] = override_session
            with TestClient(app) as client:
                yield client, session
    finally:
        engine.dispose()


def user(session: Session, role: UserRole = UserRole.ADMINISTRATOR) -> User:
    account = User(email=f"{uuid4()}@example.test", role=role)
    session.add(account)
    session.commit()
    return account


def headers(account: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(str(account.id))}"}


def row(code="CS-100", category="Algorithms", **changes):
    return {
        "template_version": "2.0",
        "certification_code": code,
        "category_name": category,
        "difficulty": "medium",
        "question_type": "multiple_choice",
        "allows_multiple_answers": False,
        "question_text": "Which structure follows FIFO?",
        "option_a": "Queue",
        "option_b": "Stack",
        "correct_answers": "A",
        "explanation": "A queue removes the first inserted element first.",
        **changes,
    }


def upload(client, account, rows):
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Questions"
    for name in ("Read Me", "Examples", "Field Guide", "Sources"):
        workbook.create_sheet(name)
    sheet.append(list(QUESTION_IMPORT_HEADERS))
    for values in rows:
        sheet.append([values.get(header) for header in QUESTION_IMPORT_HEADERS])
    output = BytesIO()
    workbook.save(output)
    workbook.close()
    response = client.post(
        BASE,
        headers=headers(account),
        files={
            "file": (
                "questions.xlsx",
                output.getvalue(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def preview(client, account, batch):
    response = client.get(
        f"{BASE}/{batch['id']}/catalog-plan", headers=headers(account)
    )
    assert response.status_code == 200, response.text
    return response.json()


def confirm(client, account, batch, plan, *, certifications=None, approved=True):
    return client.post(
        f"{BASE}/{batch['id']}/catalog-confirm",
        headers=headers(account),
        json={
            "confirm": approved,
            "plan_id": plan["plan_id"],
            "certifications": certifications if certifications is not None else [],
        },
    )


def config(code="CS-100"):
    return {
        "code": code,
        "name": "Computer Science",
        "passing_threshold_pct": 70,
        "feedback_mode": "deferred",
    }


def seed_certification(session, code="CS-100"):
    certification = Certification(
        name="Existing certification", code=code, is_published=True
    )
    session.add(certification)
    session.commit()
    return certification


def test_upload_preview_and_decline_never_create_records(environment):
    client, session = environment
    admin = user(session)
    batch = upload(client, admin, [row()])
    assert batch["status"] == "invalid"
    assert batch["can_import"] is False
    plan = preview(client, admin, batch)
    assert plan["can_confirm"] is True
    assert plan["missing_certifications"] == [{"code": "CS-100", "row_numbers": [2]}]
    assert plan["missing_categories"] == [
        {"certification_code": "CS-100", "name": "Algorithms", "row_numbers": [2]}
    ]
    assert preview(client, admin, batch) == plan
    assert (
        confirm(
            client, admin, batch, plan, certifications=[config()], approved=False
        ).status_code
        == 409
    )
    rejected = client.post(f"{BASE}/{batch['id']}/commit", headers=headers(admin))
    assert rejected.status_code == 409
    assert session.exec(select(Certification)).all() == []
    assert session.exec(select(Category)).all() == []
    assert session.exec(select(Question)).all() == []
    assert session.get(QuestionImportBatch, UUID(batch["id"])).status == "invalid"


def test_confirm_creates_unpublished_catalog_and_revalidates_without_importing(
    environment,
):
    client, session = environment
    admin = user(session)
    batch = upload(
        client,
        admin,
        [
            row(),
            row(category="algorithms", question_text="Which structure follows LIFO?"),
            row(category="Data structures", question_text="What stores a sequence?"),
        ],
    )
    plan = preview(client, admin, batch)
    assert len(plan["missing_certifications"]) == 1
    assert len(plan["missing_categories"]) == 2
    assert plan["missing_categories"][0]["row_numbers"] == [2, 3]
    response = confirm(client, admin, batch, plan, certifications=[config()])
    assert response.status_code == 200, response.text
    receipt = response.json()
    assert receipt["batch"]["status"] == "ready"
    assert receipt["batch"]["can_import"] is True
    assert receipt["batch"]["imported_rows"] == 0
    cert = session.exec(select(Certification)).one()
    assert cert.name == "Computer Science"
    assert cert.passing_threshold_pct == 70
    assert cert.is_published is False
    categories = session.exec(select(Category)).all()
    assert len(categories) == 2
    assert all(
        item.certification_id == cert.id and not item.is_published
        for item in categories
    )
    assert session.exec(select(Question)).all() == []
    # A replay cannot create duplicates or accidentally approve more records.
    assert (
        confirm(client, admin, batch, plan, certifications=[config()]).status_code
        == 409
    )
    assert len(session.exec(select(Category)).all()) == 2
    # The ordinary, separate commit still creates pending drafts.
    committed = client.post(f"{BASE}/{batch['id']}/commit", headers=headers(admin))
    assert committed.status_code == 200, committed.text
    assert committed.json()["created_count"] == 3
    assert all(
        version.publication_status == "draft" and version.review_status == "pending"
        for version in session.exec(select(QuestionVersion)).all()
    )


def test_missing_categories_under_existing_certification(environment):
    client, session = environment
    admin = user(session)
    cert = seed_certification(session)
    batch = upload(client, admin, [row()])
    plan = preview(client, admin, batch)
    assert plan["missing_certifications"] == []
    assert plan["can_confirm"] is True
    response = confirm(client, admin, batch, plan)
    assert response.status_code == 200, response.text
    assert response.json()["created_certification_ids"] == []
    category = session.exec(select(Category)).one()
    assert category.certification_id == cert.id
    assert category.is_published is False
    assert cert.is_published is True


def test_catalog_plan_stale_after_manual_category_creation(environment):
    client, session = environment
    admin = user(session)
    cert = seed_certification(session)
    batch = upload(
        client,
        admin,
        [row(), row(category="Networking", question_text="What is a network?")],
    )
    plan = preview(client, admin, batch)
    create_category(
        session, CategoryCreate(certification_id=cert.id, name="algorithms")
    )
    response = confirm(client, admin, batch, plan)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "IMPORT_CATALOG_PLAN_CHANGED"
    assert len(session.exec(select(Category)).all()) == 1
    fresh = preview(client, admin, batch)
    assert [item["name"] for item in fresh["missing_categories"]] == ["Networking"]
    assert confirm(client, admin, batch, fresh).status_code == 200


@pytest.mark.parametrize(
    "settings",
    [[], [config("OTHER")], [config(), config()], [config(), config("OTHER")]],
)
def test_confirmation_requires_exact_new_certification_configuration(
    environment, settings
):
    client, session = environment
    admin = user(session)
    batch = upload(client, admin, [row()])
    plan = preview(client, admin, batch)
    response = confirm(client, admin, batch, plan, certifications=settings)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "IMPORT_CATALOG_CONFIGURATION_MISMATCH"
    assert session.exec(select(Certification)).all() == []


def test_permission_scope_and_admin_can_resolve_contributor_batch(environment):
    client, session = environment
    owner = user(session, UserRole.CONTRIBUTOR)
    other = user(session, UserRole.CONTRIBUTOR)
    learner = user(session, UserRole.LEARNER)
    admin = user(session)
    batch = upload(client, owner, [row()])
    plan = preview(client, owner, batch)
    assert plan["can_confirm"] is False
    assert len(plan["missing_certifications"]) == 1
    url = f"{BASE}/{batch['id']}/catalog-plan"
    assert client.get(url).status_code == 401
    assert client.get(url, headers=headers(other)).status_code == 404
    assert client.get(url, headers=headers(learner)).status_code == 403
    assert (
        confirm(client, owner, batch, plan, certifications=[config()]).status_code
        == 403
    )
    assert (
        confirm(client, learner, batch, plan, certifications=[config()]).status_code
        == 403
    )
    assert session.exec(select(Certification)).all() == []
    admin_plan = preview(client, admin, batch)
    assert (
        confirm(client, admin, batch, admin_plan, certifications=[config()]).status_code
        == 200
    )
    assert (
        session.get(QuestionImportBatch, UUID(batch["id"])).uploaded_by_id == owner.id
    )


def test_cancelled_batch_cannot_create_catalog(environment):
    client, session = environment
    admin = user(session)
    batch = upload(client, admin, [row()])
    plan = preview(client, admin, batch)
    stored = session.get(QuestionImportBatch, UUID(batch["id"]))
    stored.status = "cancelled"
    session.add(stored)
    session.commit()
    assert (
        confirm(client, admin, batch, plan, certifications=[config()]).status_code
        == 409
    )
    assert session.exec(select(Certification)).all() == []


def test_blank_category_is_not_created(environment):
    client, session = environment
    admin = user(session)
    batch = upload(client, admin, [row(category=None)])
    plan = preview(client, admin, batch)
    assert plan["missing_categories"] == []
    assert (
        confirm(client, admin, batch, plan, certifications=[config()]).status_code
        == 200
    )
    assert session.exec(select(Category)).all() == []


def test_wrong_case_code_is_not_silently_created(environment):
    client, session = environment
    admin = user(session)
    seed_certification(session)
    batch = upload(client, admin, [row(code="cs-100")])
    plan = preview(client, admin, batch)
    assert plan["can_confirm"] is False
    assert plan["missing_certifications"] == []
    assert plan["blocking_issues"][0]["field"] == "certification_code"
    assert confirm(client, admin, batch, plan).status_code == 409
    assert len(session.exec(select(Certification)).all()) == 1


def test_non_catalog_errors_still_block_import_after_confirmation(environment):
    client, session = environment
    admin = user(session)
    batch = upload(
        client, admin, [row(image_filename="missing.png", image_alt_text="A diagram")]
    )
    plan = preview(client, admin, batch)
    response = confirm(client, admin, batch, plan, certifications=[config()])
    assert response.status_code == 200, response.text
    assert response.json()["batch"]["status"] == "invalid"
    assert response.json()["batch"]["can_import"] is False
    assert (
        client.post(f"{BASE}/{batch['id']}/commit", headers=headers(admin)).status_code
        == 409
    )
    assert session.exec(select(Question)).all() == []


def test_ready_batch_no_missing_records_cannot_create_anything(environment):
    client, session = environment
    admin = user(session)
    cert = seed_certification(session)
    create_category(
        session, CategoryCreate(certification_id=cert.id, name="Algorithms")
    )
    batch = upload(client, admin, [row()])
    assert batch["status"] == "ready"
    plan = preview(client, admin, batch)
    assert plan["can_confirm"] is False
    assert plan["missing_categories"] == []
    assert (
        confirm(
            client, admin, batch, plan, certifications=[config("OTHER")]
        ).status_code
        == 409
    )
    assert len(session.exec(select(Certification)).all()) == 1


def test_failed_revalidation_rolls_back_all_catalog_creations(environment, monkeypatch):
    client, session = environment
    admin = user(session)
    batch = upload(
        client,
        admin,
        [row(), row(category="Networking", question_text="What is a network?")],
    )
    plan = preview(client, admin, batch)

    def fail_validation(_session, *, batch_id):
        assert str(batch_id) == batch["id"]
        raise RuntimeError("Simulated validation failure")

    monkeypatch.setattr(
        "app.services.question_import_catalog_service.validate_question_import_batch",
        fail_validation,
    )
    with pytest.raises(RuntimeError, match="Simulated validation failure"):
        confirm(client, admin, batch, plan, certifications=[config()])
    assert session.exec(select(Certification)).all() == []
    assert session.exec(select(Category)).all() == []
    assert session.get(QuestionImportBatch, UUID(batch["id"])).status == "invalid"


def test_ambiguous_category_reference_requires_catalog_correction(environment):
    client, session = environment
    admin = user(session)
    cert = seed_certification(session)
    # Simulate a legacy ambiguous catalog that predates case-insensitive creation checks.
    session.add_all(
        [
            Category(certification_id=cert.id, name="Algorithms"),
            Category(certification_id=cert.id, name="algorithms"),
        ]
    )
    session.commit()
    batch = upload(client, admin, [row()])
    plan = preview(client, admin, batch)
    assert plan["can_confirm"] is False
    assert plan["missing_categories"] == []
    assert plan["blocking_issues"][0]["field"] == "category_name"
    assert confirm(client, admin, batch, plan).status_code == 409
    assert len(session.exec(select(Category)).all()) == 2
