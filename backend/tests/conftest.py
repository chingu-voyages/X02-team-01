from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client() -> Iterator[TestClient]:
    """A TestClient bound to the FastAPI app, with lifespan handled."""
    with TestClient(app) as test_client:
        yield test_client


# The following older business-logic fixtures create bare role rows/JWTs.
# Exercise their existing rules independently of mandatory enrollment, until
# the fixtures are migrated to real MFA sign-in. New tests are strict by default.
LEGACY_UNENROLLED_ADMIN_MODULES = frozenset(
    {
        "test_admin_category_api.py",
        "test_admin_certification_api.py",
        "test_admin_practice_exam_deletion.py",
        "test_admin_practice_exams_api.py",
        "test_admin_question_api.py",
        "test_admin_question_bank_api.py",
        "test_admin_question_edit_api.py",
        "test_admin_question_image_api.py",
        "test_admin_question_publish_api.py",
        "test_admin_question_reject_api.py",
        "test_admin_question_revision_api.py",
        "test_admin_users_api.py",
        "test_exam_configuration_isolation.py",
        "test_jhep126_final_integration.py",
        "test_jhep159_admin_to_learner_workflow.py",
        "test_jhep203_attempt_isolation.py",
        "test_learner_published_exams.py",
        "test_question_import_api.py",
        "test_question_import_asset_api.py",
        "test_question_import_catalog_api.py",
        "test_question_import_commit_api.py",
        "test_question_import_postgres.py",
        "test_question_import_publish_api.py",
        "test_question_import_workflow_api.py",
        "test_question_rejection_feedback_api.py",
        "test_question_retirement_api.py",
        "test_role_authorization.py",
    }
)


@pytest.fixture(autouse=True)
def legacy_unenrolled_admin_fixture(request, monkeypatch):
    """Only old domain fixtures; MFA/security enrollment tests stay strict."""
    if request.node.path.name in LEGACY_UNENROLLED_ADMIN_MODULES:
        from app.services import mfa_service

        monkeypatch.setattr(
            mfa_service, "administrator_requires_enrollment", lambda _user: False
        )
