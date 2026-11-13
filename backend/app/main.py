import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.endpoints.auth import CodedAuthError
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


@app.on_event("startup")
def validate_email_transport() -> None:
    """Surface a misconfigured email transport at startup, loudly.

    Per-request delivery is resilient (a failed send never 500s
    registration), so the ONLY place a broken transport configuration is
    named is this log line — check it first when verification emails do
    not arrive.
    """
    from app.services.email_delivery import email_sender

    try:
        sender = email_sender()
        logging.getLogger(__name__).info(
            "Email transport ready: %s (EMAIL_DELIVERY=%s)",
            type(sender).__name__,
            settings.email_delivery,
        )
    except Exception:  # noqa: BLE001 — warn, never block the deploy
        logging.getLogger(__name__).critical(
            "Email transport is MISCONFIGURED (EMAIL_DELIVERY=%s): "
            "verification emails will not be sent until the environment "
            "provides the required variables. Registration itself keeps "
            "working. See docs/configuration.md.",
            settings.email_delivery,
        )


# Auth-family error rendering (JHEP-24): CodedAuthError bodies land at the
# TOP level as {"code", "message"} — the RegisterForm reads `data.message`
# (JHEP-99 compatibility). Exam endpoints keep their {"detail": {...}} shape.
@app.exception_handler(CodedAuthError)
async def coded_auth_error_handler(request: Request, exc: CodedAuthError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.code, "message": exc.message},
    )


# Shape malformed 422s for the auth family: schema-validation failures
# surface as {"code": "VALIDATION_ERROR", "message": <first field>}, scoped
# to /api/v1/auth paths only — exam routes keep the standard 422 shape.
@app.exception_handler(RequestValidationError)
async def auth_validation_error_handler(request: Request, exc: RequestValidationError):
    if not request.url.path.startswith("/api/v1/auth"):
        return JSONResponse(status_code=422, content={"detail": exc.errors()})

    errors = exc.errors()
    first = errors[0] if errors else {}
    field = ".".join(str(part) for part in first.get("loc", ()) if part != "body")
    message = first.get("msg", "Invalid value")
    readable = f"{field}: {message}" if field else message

    return JSONResponse(
        status_code=422,
        content={"code": "VALIDATION_ERROR", "message": readable},
    )


# Liveness probe used by Docker healthchecks and CI
@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
