from fastapi import APIRouter

from app.api.v1.endpoints import exams, questions

api_router = APIRouter()

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
