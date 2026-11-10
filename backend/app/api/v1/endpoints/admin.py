"""Role-protected administrative API routes."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.api.deps import get_current_user, require_contributor_or_administrator
from app.db.session import get_session
from app.models.user import User
from app.schemas.admin_question import (
    AdminAnswerOptionOut,
    QuestionBankDetail,
    QuestionBankItem,
    QuestionBankList,
    QuestionDraftCreate,
    QuestionDraftCreated,
    QuestionDraftEdit,
)
from app.services.admin_question_service import (
    QuestionBankDetails,
    QuestionBankNotFoundError,
    QuestionDraftNotEditableError,
    QuestionDraftScopeError,
    create_question_draft,
    edit_question_draft,
    get_question_bank_details,
    list_question_bank,
)

router = APIRouter(
    dependencies=[Depends(require_contributor_or_administrator)],
)


def _question_detail_response(
    detail: QuestionBankDetails,
) -> QuestionBankDetail:
    return QuestionBankDetail(
        question_id=detail.question_id,
        question_version_id=detail.question_version_id,
        version_number=detail.version_number,
        certification_id=detail.certification_id,
        certification_name=detail.certification_name,
        category_id=detail.category_id,
        category_name=detail.category_name,
        difficulty=detail.difficulty,
        question_text=detail.question_text,
        question_type=detail.question_type,
        allows_multiple_answers=detail.allows_multiple_answers,
        explanation=detail.explanation,
        review_status=detail.review_status,
        publication_status=detail.publication_status,
        is_flagged=detail.is_flagged,
        created_by_id=detail.created_by_id,
        submitted_by_id=detail.submitted_by_id,
        last_updated=detail.last_updated,
        options=[
            AdminAnswerOptionOut(
                position=option.position,
                option_text=option.option_text,
                is_correct=option.is_correct,
            )
            for option in detail.options
        ],
        expected_answer=detail.expected_answer,
    )


@router.get(
    "/questions",
    response_model=QuestionBankList,
)
def list_managed_questions(
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> QuestionBankList:
    """Return question-bank rows permitted by the manager's role."""
    records = list_question_bank(
        session,
        actor=current_user,
    )

    return QuestionBankList(
        items=[
            QuestionBankItem(
                question_id=item.question_id,
                question_version_id=item.question_version_id,
                version_number=item.version_number,
                question_preview=item.question_preview,
                certification_id=item.certification_id,
                certification_name=item.certification_name,
                category_id=item.category_id,
                category_name=item.category_name,
                difficulty=item.difficulty,
                question_type=item.question_type,
                review_status=item.review_status,
                publication_status=item.publication_status,
                is_flagged=item.is_flagged,
                created_by_id=item.created_by_id,
                last_updated=item.last_updated,
            )
            for item in records
        ],
        count=len(records),
    )


@router.get(
    "/questions/{question_id}",
    response_model=QuestionBankDetail,
)
def get_managed_question(
    question_id: UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> QuestionBankDetail:
    """Return trusted latest-version content for one permitted question."""
    try:
        detail = get_question_bank_details(
            session,
            question_id,
            actor=current_user,
        )
    except QuestionBankNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Question not found",
        ) from exc

    return _question_detail_response(detail)


@router.patch(
    "/questions/{question_id}",
    response_model=QuestionBankDetail,
)
def edit_managed_question(
    question_id: UUID,
    payload: QuestionDraftEdit,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> QuestionBankDetail:
    """Replace editable fields on one permitted draft question."""
    try:
        detail = edit_question_draft(
            session,
            question_id,
            payload,
            actor=current_user,
        )
    except QuestionBankNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Question not found",
        ) from exc
    except QuestionDraftNotEditableError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    except QuestionDraftScopeError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc

    return _question_detail_response(detail)


@router.post(
    "/questions",
    response_model=QuestionDraftCreated,
    status_code=status.HTTP_201_CREATED,
)
def create_draft_question(
    payload: QuestionDraftCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> QuestionDraftCreated:
    """Create version 1 of a question in pending/draft state."""
    try:
        created = create_question_draft(
            session,
            payload,
            actor_id=current_user.id,
        )
    except QuestionDraftScopeError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc

    return QuestionDraftCreated(
        question_id=created.question_id,
        question_version_id=created.question_version_id,
        version_number=created.version_number,
        review_status=created.review_status,
        publication_status=created.publication_status,
    )
