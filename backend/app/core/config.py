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
    # shows a real mailbox with its link. Production transport is
    # committed only after JHEP-102 confirms the provider decision.
    email_delivery: Literal["console", "mailpit"] = "console"
    email_smtp_host: str = "127.0.0.1"
    email_smtp_port: int = 1025
    email_from: str = "no-reply@jobhackers.local"
    verification_link_base: str = "http://127.0.0.1:8010/api/v1/auth/verify"

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
