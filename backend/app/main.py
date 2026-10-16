from fastapi import FastAPI

# Application instance served by uvicorn as `app.main:app`
app = FastAPI(title="JHEP API")


# Liveness probe used by Docker healthchecks and CI
@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
