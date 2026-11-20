from fastapi import APIRouter

from app.api.v1.endpoints import (
    admin,
    auth,
    categories,
    exams,
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
    question_imports.router,
    prefix="/admin/question-imports",
    tags=["admin", "question-imports"],
)
