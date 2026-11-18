from typing import Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
)


class CertificationCreate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )

    name: str = Field(
        min_length=1,
        max_length=255,
    )

    code: str = Field(
        min_length=1,
        max_length=50,
    )

    passing_threshold_pct: int = Field(
        ge=0,
        le=100,
    )

    feedback_mode: Literal[
        "immediate",
        "deferred",
    ] = "deferred"

    @field_validator("name")
    @classmethod
    def normalize_name(
        cls,
        value: str,
    ) -> str:
        normalized = value.strip()

        if not normalized:
            raise ValueError("name must not be blank")

        return normalized

    @field_validator("code")
    @classmethod
    def normalize_code(
        cls,
        value: str,
    ) -> str:
        normalized = value.strip().upper()

        if not normalized:
            raise ValueError("code must not be blank")

        return normalized


class CertificationPublicationUpdate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )

    is_published: bool


class CertificationOut(BaseModel):
    id: UUID
    name: str
    code: str
    passing_threshold_pct: int | None

    feedback_mode: Literal[
        "immediate",
        "deferred",
    ]

    is_published: bool


class CertificationList(BaseModel):
    items: list[CertificationOut]

    count: int
