from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
)


class CategoryCreate(BaseModel):
    """Administrator request for a new category."""

    model_config = ConfigDict(
        extra="forbid",
    )

    certification_id: UUID

    name: str = Field(
        min_length=1,
        max_length=255,
    )

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


class CategoryPublicationUpdate(BaseModel):
    """Administrator publication state update."""

    model_config = ConfigDict(
        extra="forbid",
    )

    is_published: bool


class AdminCategoryOut(BaseModel):
    """Category metadata visible through management APIs."""

    id: UUID
    certification_id: UUID
    certification_name: str
    name: str
    is_published: bool


class AdminCategoryList(BaseModel):
    """Administrative category collection."""

    items: list[AdminCategoryOut]
    count: int
