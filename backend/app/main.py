from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import settings

# Application instance served by uvicorn as `app.main:app`
app = FastAPI(title="JHEP API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")


# Liveness probe used by Docker healthchecks and CI
@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
