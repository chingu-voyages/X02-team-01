from fastapi import APIRouter

from app.api.v1.endpoints import questions

api_router = APIRouter()

api_router.include_router(
    questions.router,
    prefix="/questions",
    tags=["questions"],
)
