from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL

ROOT_DIR = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    postgres_db: str
    postgres_user: str
    postgres_password: str

    postgres_host: str = "127.0.0.1"
    postgres_port: int = 5432

    # JWT Authentication
    jwt_secret_key: str
    jwt_algorithm: Literal["HS256"] = "HS256"
    access_token_expire_minutes: int = 30

    # CORS
    cors_origins: str = "http://localhost:3000"

    # JHEP-24: registration verification email delivery.
    # `console` ship default: writes the verification link to the log
    # (deterministic tests/CI). `mailpit`: local SMTP catcher so the demo
    # shows a real mailbox with its link. `smtp`: a REAL external transport
    # (Gmail app-password, Mailgun, SES, SendGrid, Brevo — any SMTP) — the
    # universal production path. `resend`: Resend's HTTPS API. Production
    # transport is committed only after JHEP-102 confirms the provider
    # decision.
    email_delivery: Literal["console", "mailpit", "smtp", "resend"] = "console"
    email_smtp_host: str = "127.0.0.1"
    email_smtp_port: int = 1025
    email_smtp_user: str = ""
    email_smtp_password: str = ""
    email_smtp_starttls: bool = True
    email_api_key: str = ""  # resend only; empty = not configured
    email_from: str = "no-reply@jobhackers.local"
    verification_link_base: str = "http://127.0.0.1:8010/api/v1/auth/verify"

    # Env values copied from docs or dashboards often carry stray
    # whitespace/newlines, which would fail Literal validation and crash
    # startup (seen live on Render: 'smtp\n'). Strip strings first; an
    # email_delivery left empty after stripping means "not chosen" -> the
    # console default. Same stripping for the link base (a trailing
    # newline would silently corrupt the verification URL).
    @field_validator("email_delivery", mode="before")
    @classmethod
    def _normalise_email_delivery(cls, value):  # noqa: N805
        if isinstance(value, str):
            value = value.strip()
        return value or "console"

    @field_validator("verification_link_base", mode="before")
    @classmethod
    def _normalise_verification_link_base(cls, value):  # noqa: N805
        if isinstance(value, str):
            value = value.strip()
        return value or "http://127.0.0.1:8010/api/v1/auth/verify"

    # SMTP/API credentials pasted into a hosting dashboard with a trailing
    # newline would fail provider auth at send time (a confusing silent
    # failure) — strip them the same way.
    @field_validator(
        "email_from",
        "email_smtp_user",
        "email_smtp_password",
        "email_api_key",
        mode="before",
    )
    @classmethod
    def _strip_email_credential_whitespace(cls, value):  # noqa: N805
        if isinstance(value, str):
            return value.strip()
        return value

    # JHEP-24: verification-link TTL + resend throttle (env-configurable
    # rather than hardcoded — the board's policy table drives the values).
    verify_token_ttl_hours: int = Field(default=24, ge=1, le=168)
    resend_interval_seconds: int = Field(default=60, ge=1, le=86400)

    # JHEP-25: learner session TTL. The default 30-minute token expires
    # mid-exam, so learner sessions get a dedicated, longer lifetime.
    # Logout is stateless (client discards; JWT expiry is the server-side
    # bound) — server-side invalidation is a documented follow-up.
    learner_access_token_hours: int = Field(default=12, ge=1, le=24 * 7)

    # Site deployments can enforce a smaller exam; hard ceiling remains 100.
    max_exam_questions: int = Field(default=100, ge=1, le=100)

    # Public HTTPS R2/CDN asset base. A missing value means image URLs are
    # unavailable, but the API still returns the image's alt text/metadata.
    media_base_url: str | None = None

    @field_validator("media_base_url")
    @classmethod
    def require_https_asset_base(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        parsed = urlsplit(value)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("MEDIA_BASE_URL must be a public HTTPS base URL")
        return value.rstrip("/")

    model_config = SettingsConfigDict(
        env_file=ROOT_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def database_url(self) -> URL:
        return URL.create(
            drivername="postgresql+psycopg",
            username=self.postgres_user,
            password=self.postgres_password,
            host=self.postgres_host,
            port=self.postgres_port,
            database=self.postgres_db,
        )

    @property
    def cors_origins_list(self) -> list[str]:
        if not self.cors_origins:
            return ["http://localhost:3000"]
        origins = [origin.strip() for origin in self.cors_origins.split(",")]
        return [origin for origin in origins if origin]


settings = Settings()
