"""Learner-facing contracts for available practice exam categories (JHEP-27)."""

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CategoryOut(BaseModel):
    """Public metadata for one available category, without question content."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    id: UUID
    certification_id: UUID
    name: str = Field(min_length=1, max_length=255)
    certification_name: str = Field(min_length=1, max_length=255)
    available_question_count: int = Field(strict=True, ge=1)


class CategoryListOut(BaseModel):
    """An empty categories list is a valid response, not a loading failure."""

    model_config = ConfigDict(extra="forbid")

    categories: list[CategoryOut] = Field(default_factory=list)
