from fastapi import FastAPI

from app.api.v1.router import api_router

# Application instance served by uvicorn as `app.main:app`
app = FastAPI(title="JHEP API")

app.include_router(api_router, prefix="/api/v1")


# Liveness probe used by Docker healthchecks and CI
@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
