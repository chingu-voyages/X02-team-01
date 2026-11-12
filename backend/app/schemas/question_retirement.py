"""API contracts for retiring practice questions (JHEP-130)."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class QuestionRetirementRequest(BaseModel):
    """Require an explicit confirmation before a retirement mutation."""

    model_config = ConfigDict(extra="forbid")

    confirm: Literal[True]


class QuestionRetirementResponse(BaseModel):
    """Server response after an idempotent retirement action."""

    question_id: UUID
    retired_version_ids: list[UUID]
    publication_status: Literal["retired"] = "retired"
    already_retired: bool
