from collections.abc import Iterator
from uuid import uuid4

import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import (
    Session,
    SQLModel,
    create_engine,
)

from app.core.security import hash_password
from app.db.session import get_session
from app.main import app
from app.models import (
    AnswerOption,
    Category,
    Certification,
    ExamAttempt,
    ExamAttemptQuestion,
    Question,
    QuestionImage,
    QuestionVersion,
    User,
)


def create_user(
    session: Session,
    *,
    email: str,
    password: str,
    role: str,
) -> User:
    user = User(
        email=email,
        full_name=("Administrator" if role == "administrator" else "Learner"),
        hashed_password=hash_password(password),
        role=role,
        is_verified=True,
    )

    session.add(user)
    session.commit()
    session.refresh(user)

    return user


def auth_header(
    token: str,
) -> dict[str, str]:
    return {"Authorization": (f"Bearer {token}")}


@sa.event.listens_for(
    sa.engine.Engine,
    "connect",
)
def enable_sqlite_foreign_keys(
    dbapi_connection,
    _connection_record,
):
    if dbapi_connection.__class__.__module__ == "sqlite3":
        cursor = dbapi_connection.cursor()

        cursor.execute("PRAGMA foreign_keys=ON")

        cursor.close()


def test_full_admin_to_learner_publication_workflow():
    engine = create_engine(
        "sqlite://",
        connect_args={
            "check_same_thread": False,
        },
        poolclass=StaticPool,
    )

    SQLModel.metadata.create_all(
        engine,
        tables=[
            User.__table__,
            Certification.__table__,
            Category.__table__,
            Question.__table__,
            QuestionVersion.__table__,
            AnswerOption.__table__,
            QuestionImage.__table__,
            ExamAttempt.__table__,
            ExamAttemptQuestion.__table__,
        ],
    )

    with Session(engine) as session:
        administrator_email = f"admin-{uuid4()}@example.test"

        learner_email = f"learner-{uuid4()}@example.test"

        administrator_password = "AdminPass1!"

        learner_password = "LearnerPass1!"

        create_user(
            session,
            email=administrator_email,
            password=administrator_password,
            role="administrator",
        )

        create_user(
            session,
            email=learner_email,
            password=learner_password,
            role="learner",
        )

        def override_session() -> Iterator[Session]:
            yield session

        app.dependency_overrides[get_session] = override_session

        try:
            with TestClient(app) as client:
                # ---------------------------------------------
                # Real administrator login.
                # ---------------------------------------------
                admin_login = client.post(
                    "/api/v1/auth/login",
                    json={
                        "email": (administrator_email),
                        "password": (administrator_password),
                    },
                )

                assert admin_login.status_code == 200

                admin_body = admin_login.json()

                assert admin_body["learner"]["role"] == "administrator"

                admin_token = admin_body["access_token"]

                # ---------------------------------------------
                # Real learner login.
                # ---------------------------------------------
                learner_login = client.post(
                    "/api/v1/auth/login",
                    json={
                        "email": (learner_email),
                        "password": (learner_password),
                    },
                )

                assert learner_login.status_code == 200

                assert learner_login.json()["learner"]["role"] == "learner"

                learner_token = learner_login.json()["access_token"]

                admin_headers = auth_header(admin_token)

                learner_headers = auth_header(learner_token)

                # ---------------------------------------------
                # Learner catalog starts empty.
                # ---------------------------------------------
                initial_catalog = client.get(
                    "/api/v1/categories",
                    headers=learner_headers,
                )

                assert initial_catalog.status_code == 200

                assert initial_catalog.json()["categories"] == []

                # ---------------------------------------------
                # Admin creates Certification.
                # New certifications are unpublished.
                # ---------------------------------------------
                certification_response = client.post(
                    "/api/v1/admin/certifications",
                    headers=(admin_headers),
                    json={
                        "name": ("JHEP 159 Demo Certification"),
                        "code": ("JHEP-159-DEMO"),
                        "passing_threshold_pct": (70),
                        "feedback_mode": ("immediate"),
                    },
                )

                assert certification_response.status_code == 201

                certification = certification_response.json()

                certification_id = certification["id"]

                assert certification["is_published"] is False

                # ---------------------------------------------
                # Admin creates Category.
                # New categories are unpublished.
                # ---------------------------------------------
                category_response = client.post(
                    "/api/v1/admin/categories",
                    headers=(admin_headers),
                    json={
                        "certification_id": (certification_id),
                        "name": ("Full Workflow"),
                    },
                )

                assert category_response.status_code == 201

                category = category_response.json()

                category_id = category["id"]

                assert category["is_published"] is False

                # ---------------------------------------------
                # Admin creates Question.
                # ---------------------------------------------
                question_response = client.post(
                    "/api/v1/admin/questions",
                    headers=(admin_headers),
                    json={
                        "certification_id": (certification_id),
                        "category_id": (category_id),
                        "difficulty": ("easy"),
                        "question_text": ("What is 2 + 2?"),
                        "question_type": ("multiple_choice"),
                        "allows_multiple_answers": (False),
                        "explanation": ("Two plus two equals four."),
                        "options": [
                            {
                                "option_text": ("4"),
                                "is_correct": (True),
                            },
                            {
                                "option_text": ("5"),
                                "is_correct": (False),
                            },
                        ],
                        "expected_answer": (None),
                    },
                )

                assert question_response.status_code == 201

                question = question_response.json()

                question_id = question["question_id"]

                assert question["review_status"] == "pending"

                assert question["publication_status"] == "draft"

                # ---------------------------------------------
                # Learner cannot see unpublished content.
                # ---------------------------------------------
                hidden_catalog = client.get(
                    "/api/v1/categories",
                    headers=learner_headers,
                )

                assert hidden_catalog.status_code == 200

                assert hidden_catalog.json()["categories"] == []

                # ---------------------------------------------
                # Admin approves + publishes Question.
                # ---------------------------------------------
                publish_question = client.post(
                    (f"/api/v1/admin/questions/{question_id}/publish"),
                    headers=admin_headers,
                )

                assert publish_question.status_code == 200

                published_question = publish_question.json()

                assert published_question["review_status"] == "approved"

                assert published_question["publication_status"] == "active"

                # Question alone is not enough.
                # Category and certification remain hidden.
                still_hidden = client.get(
                    "/api/v1/categories",
                    headers=learner_headers,
                )

                assert still_hidden.status_code == 200

                assert still_hidden.json()["categories"] == []

                # ---------------------------------------------
                # Publish Category.
                # ---------------------------------------------
                publish_category = client.patch(
                    (f"/api/v1/admin/categories/{category_id}/publication"),
                    headers=admin_headers,
                    json={
                        "is_published": True,
                    },
                )

                assert publish_category.status_code == 200

                assert publish_category.json()["is_published"] is True

                # Certification is still unpublished.
                category_only_catalog = client.get(
                    "/api/v1/categories",
                    headers=(learner_headers),
                )

                assert category_only_catalog.status_code == 200

                assert category_only_catalog.json()["categories"] == []

                # ---------------------------------------------
                # Direct exam-start attempt must also fail while
                # certification is unpublished.
                # ---------------------------------------------
                blocked_exam = client.post(
                    "/api/v1/exams",
                    headers=learner_headers,
                    json={
                        "certification_id": (certification_id),
                        "category_id": (category_id),
                        "question_count": 1,
                    },
                )

                assert blocked_exam.status_code == 409

                # ---------------------------------------------
                # Publish Certification.
                # ---------------------------------------------
                publish_certification = client.patch(
                    (f"/api/v1/admin/certifications/{certification_id}/publication"),
                    headers=(admin_headers),
                    json={
                        "is_published": (True),
                    },
                )

                assert publish_certification.status_code == 200

                assert publish_certification.json()["is_published"] is True

                # ---------------------------------------------
                # Learner can now discover Category.
                # ---------------------------------------------
                visible_catalog = client.get(
                    "/api/v1/categories",
                    headers=learner_headers,
                )

                assert visible_catalog.status_code == 200

                categories = visible_catalog.json()["categories"]

                assert len(categories) == 1

                assert categories[0]["id"] == category_id

                assert categories[0]["certification_id"] == certification_id

                assert categories[0]["name"] == "Full Workflow"

                assert categories[0]["available_question_count"] == 1

                # ---------------------------------------------
                # Learner starts the real exam.
                # ---------------------------------------------
                exam_response = client.post(
                    "/api/v1/exams",
                    headers=learner_headers,
                    json={
                        "certification_id": (certification_id),
                        "category_id": (category_id),
                        "question_count": 1,
                    },
                )

                assert exam_response.status_code == 201

                exam = exam_response.json()

                assert exam["status"] == "in_progress"

                assert exam["certification_id"] == certification_id

                assert exam["question_count"] == 1

                assert len(exam["questions"]) == 1

                assert exam["questions"][0]["question_text"] == "What is 2 + 2?"

                # Never expose answer keys in learner delivery.
                for option in exam["questions"][0]["options"]:
                    assert "is_correct" not in option

                # ---------------------------------------------
                # Admin unpublishes Category.
                # ---------------------------------------------
                unpublish_category = client.patch(
                    (f"/api/v1/admin/categories/{category_id}/publication"),
                    headers=(admin_headers),
                    json={
                        "is_published": (False),
                    },
                )

                assert unpublish_category.status_code == 200

                assert unpublish_category.json()["is_published"] is False

                # New learner discovery immediately hides it.
                hidden_again = client.get(
                    "/api/v1/categories",
                    headers=learner_headers,
                )

                assert hidden_again.status_code == 200

                assert hidden_again.json()["categories"] == []

                # ---------------------------------------------
                # Republish Category, then unpublish Certification.
                # ---------------------------------------------
                republish_category = client.patch(
                    (f"/api/v1/admin/categories/{category_id}/publication"),
                    headers=admin_headers,
                    json={
                        "is_published": True,
                    },
                )

                assert republish_category.status_code == 200

                unpublish_certification = client.patch(
                    (f"/api/v1/admin/certifications/{certification_id}/publication"),
                    headers=(admin_headers),
                    json={
                        "is_published": (False),
                    },
                )

                assert unpublish_certification.status_code == 200

                assert unpublish_certification.json()["is_published"] is False

                hidden_by_certification = client.get(
                    "/api/v1/categories",
                    headers=(learner_headers),
                )

                assert hidden_by_certification.status_code == 200

                assert hidden_by_certification.json()["categories"] == []

        finally:
            app.dependency_overrides.clear()

    engine.dispose()
