"""Administrator-only eligibility and explicit promotion endpoints."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from sqlmodel import Session

from app.api.deps import bearer_scheme, require_administrator
from app.db.session import get_session
from app.models import User
from app.schemas.admin_promotion import (
    AdministratorPromotionEligibility,
    AdministratorPromotionIn,
    AdministratorPromotionOut,
)
from app.services.admin_promotion_service import (
    PromotionError,
    get_administrator_promotion_eligibility,
    promote_administrator,
)

router = APIRouter()


def _token(credentials: HTTPAuthorizationCredentials | None) -> str:
    if credentials is None:
        raise HTTPException(
            401,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return credentials.credentials


def _http_error(error: PromotionError) -> HTTPException:
    return HTTPException(
        status_code=error.status_code,
        detail={"code": error.code, "message": str(error)},
        headers={"WWW-Authenticate": "Bearer"} if error.status_code == 401 else None,
    )


@router.get(
    "/{user_id}/administrator-promotion",
    response_model=AdministratorPromotionEligibility,
)
def preview_administrator_promotion(
    user_id: UUID,
    actor: Annotated[User, Depends(require_administrator)],
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    session: Annotated[Session, Depends(get_session)],
) -> AdministratorPromotionEligibility:
    try:
        return get_administrator_promotion_eligibility(
            session, actor=actor, target_id=user_id, token=_token(credentials)
        )
    except PromotionError as exc:
        raise _http_error(exc) from exc


@router.post(
    "/{user_id}/administrator-promotion", response_model=AdministratorPromotionOut
)
def confirm_administrator_promotion(
    user_id: UUID,
    payload: AdministratorPromotionIn,
    actor: Annotated[User, Depends(require_administrator)],
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    session: Annotated[Session, Depends(get_session)],
) -> AdministratorPromotionOut:
    try:
        return promote_administrator(
            session,
            actor_id=actor.id,
            target_id=user_id,
            token=_token(credentials),
            payload=payload,
        )
    except PromotionError as exc:
        raise _http_error(exc) from exc
