from fastapi import APIRouter

from app.api.v1.endpoints import (
    admin,
    admin_practice_exams,
    auth,
    categories,
    exams,
    learner_practice_exams,
    question_import_actions,
    question_import_catalog,
    question_imports,
    questions,
)

api_router = APIRouter()

api_router.include_router(
    auth.router,
    prefix="/auth",
    tags=["auth"],
)

api_router.include_router(
    categories.router,
    prefix="/categories",
    tags=["categories"],
)

api_router.include_router(
    questions.router,
    prefix="/questions",
    tags=["questions"],
)

api_router.include_router(
    learner_practice_exams.router,
    prefix="/exams",
    tags=["exams"],
)

api_router.include_router(
    exams.router,
    prefix="/exams",
    tags=["exams"],
)

api_router.include_router(
    admin.router,
    prefix="/admin",
    tags=["admin"],
)

api_router.include_router(
    admin_practice_exams.router,
    prefix="/admin/practice-exams",
    tags=["admin", "practice-exams"],
)

api_router.include_router(
    question_imports.router,
    prefix="/admin/question-imports",
    tags=["admin", "question-imports"],
)

api_router.include_router(
    question_import_actions.router,
    prefix="/admin/question-imports",
    tags=["admin", "question-imports"],
)

api_router.include_router(
    question_import_catalog.router,
    prefix="/admin/question-imports",
    tags=["admin", "question-imports"],
)
