"""Role-protected administrative API routes."""

from fastapi import APIRouter, Depends

from app.api.deps import require_contributor_or_administrator

router = APIRouter(
    dependencies=[
        Depends(require_contributor_or_administrator),
    ]
)
