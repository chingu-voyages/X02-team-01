"""Role-protected administrative API routes."""

from typing import Annotated
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    status,
)
from sqlmodel import Session

from app.api.deps import (
    get_current_user,
    require_administrator,
    require_contributor_or_administrator,
)
from app.db.session import get_session
from app.models.user import User
from app.schemas.admin_category import (
    AdminCategoryList,
    AdminCategoryOut,
    CategoryCreate,
    CategoryPublicationUpdate,
)
from app.schemas.admin_certification import (
    CertificationCreate,
    CertificationList,
    CertificationOut,
    CertificationPublicationUpdate,
)
from app.schemas.admin_question import (
    AdminAnswerOptionOut,
    QuestionBankDetail,
    QuestionBankItem,
    QuestionBankList,
    QuestionDraftCreate,
    QuestionDraftCreated,
    QuestionDraftEdit,
    QuestionRejectionRequest,
)
from app.schemas.question_retirement import (
    QuestionRetirementRequest,
    QuestionRetirementResponse,
)
from app.services.admin_category_service import (
    AdminCategoryNotFoundError,
    CategoryCertificationNotFoundError,
    CategoryNameConflictError,
    create_category,
    list_categories,
    set_category_publication,
)
from app.services.admin_certification_service import (
    CertificationCodeConflictError,
    CertificationNotFoundError,
    create_certification,
    list_certifications,
    set_certification_publication,
)
from app.services.admin_question_service import (
    QuestionBankDetails,
    QuestionBankNotFoundError,
    QuestionDraftNotEditableError,
    QuestionDraftNotPublishableError,
    QuestionDraftNotRejectableError,
    QuestionDraftScopeError,
    QuestionPublishedRevisionForbiddenError,
    create_question_draft,
    edit_question_draft,
    get_question_bank_details,
    list_question_bank,
    publish_question_draft,
    reject_question_draft,
)
from app.services.question_retirement_service import (
    QuestionNotRetirableError,
    QuestionRetirementNotFoundError,
    retire_question,
)

router = APIRouter(
    dependencies=[Depends(require_contributor_or_administrator)],
)


def _category_response(
    category,
) -> AdminCategoryOut:
    return AdminCategoryOut(
        id=category.id,
        certification_id=(category.certification_id),
        certification_name=(category.certification_name),
        name=category.name,
        is_published=(category.is_published),
    )


def _certification_response(
    certification,
) -> CertificationOut:
    return CertificationOut(
        id=certification.id,
        name=certification.name,
        code=certification.code,
        passing_threshold_pct=(certification.passing_threshold_pct),
        feedback_mode=(certification.feedback_mode),
        is_published=(certification.is_published),
    )


def _question_detail_response(
    detail: QuestionBankDetails,
) -> QuestionBankDetail:
    return QuestionBankDetail(
        question_id=detail.question_id,
        question_version_id=(detail.question_version_id),
        version_number=detail.version_number,
        certification_id=(detail.certification_id),
        certification_name=(detail.certification_name),
        category_id=detail.category_id,
        category_name=detail.category_name,
        difficulty=detail.difficulty,
        question_text=detail.question_text,
        question_type=detail.question_type,
        allows_multiple_answers=(detail.allows_multiple_answers),
        explanation=detail.explanation,
        review_status=detail.review_status,
        publication_status=(detail.publication_status),
        is_flagged=detail.is_flagged,
        created_by_id=detail.created_by_id,
        submitted_by_id=(detail.submitted_by_id),
        last_updated=detail.last_updated,
        options=[
            AdminAnswerOptionOut(
                position=option.position,
                option_text=(option.option_text),
                is_correct=(option.is_correct),
            )
            for option in detail.options
        ],
        expected_answer=(detail.expected_answer),
    )


@router.get(
    "/certifications",
    response_model=CertificationList,
)
def list_managed_certifications(
    session: Annotated[
        Session,
        Depends(get_session),
    ],
) -> CertificationList:
    records = list_certifications(session)

    return CertificationList(
        items=[_certification_response(item) for item in records],
        count=len(records),
    )


@router.post(
    "/certifications",
    response_model=CertificationOut,
    status_code=status.HTTP_201_CREATED,
)
def create_managed_certification(
    payload: CertificationCreate,
    _administrator: Annotated[
        User,
        Depends(require_administrator),
    ],
    session: Annotated[
        Session,
        Depends(get_session),
    ],
) -> CertificationOut:
    try:
        certification = create_certification(
            session,
            payload,
        )
    except CertificationCodeConflictError as exc:
        raise HTTPException(
            status_code=(status.HTTP_409_CONFLICT),
            detail=str(exc),
        ) from exc

    return _certification_response(certification)


@router.patch(
    "/certifications/{certification_id}/publication",
    response_model=CertificationOut,
)
def update_certification_publication(
    certification_id: UUID,
    payload: CertificationPublicationUpdate,
    _administrator: Annotated[
        User,
        Depends(require_administrator),
    ],
    session: Annotated[
        Session,
        Depends(get_session),
    ],
) -> CertificationOut:
    try:
        certification = set_certification_publication(
            session,
            certification_id,
            is_published=(payload.is_published),
        )
    except CertificationNotFoundError as exc:
        raise HTTPException(
            status_code=(status.HTTP_404_NOT_FOUND),
            detail="Certification not found",
        ) from exc

    return _certification_response(certification)


@router.get(
    "/categories",
    response_model=AdminCategoryList,
)
def list_managed_categories(
    session: Annotated[
        Session,
        Depends(get_session),
    ],
    certification_id: UUID | None = None,
) -> AdminCategoryList:
    records = list_categories(
        session,
        certification_id=(certification_id),
    )

    return AdminCategoryList(
        items=[_category_response(item) for item in records],
        count=len(records),
    )


@router.post(
    "/categories",
    response_model=AdminCategoryOut,
    status_code=status.HTTP_201_CREATED,
)
def create_managed_category(
    payload: CategoryCreate,
    _administrator: Annotated[
        User,
        Depends(require_administrator),
    ],
    session: Annotated[
        Session,
        Depends(get_session),
    ],
) -> AdminCategoryOut:
    try:
        category = create_category(
            session,
            payload,
        )

    except CategoryCertificationNotFoundError as exc:
        raise HTTPException(
            status_code=(status.HTTP_404_NOT_FOUND),
            detail="Certification not found",
        ) from exc

    except CategoryNameConflictError as exc:
        raise HTTPException(
            status_code=(status.HTTP_409_CONFLICT),
            detail=str(exc),
        ) from exc

    return _category_response(category)


@router.patch(
    "/categories/{category_id}/publication",
    response_model=AdminCategoryOut,
)
def update_category_publication(
    category_id: UUID,
    payload: CategoryPublicationUpdate,
    _administrator: Annotated[
        User,
        Depends(require_administrator),
    ],
    session: Annotated[
        Session,
        Depends(get_session),
    ],
) -> AdminCategoryOut:
    try:
        category = set_category_publication(
            session,
            category_id,
            is_published=(payload.is_published),
        )

    except AdminCategoryNotFoundError as exc:
        raise HTTPException(
            status_code=(status.HTTP_404_NOT_FOUND),
            detail="Category not found",
        ) from exc

    except CategoryCertificationNotFoundError as exc:
        raise HTTPException(
            status_code=(status.HTTP_404_NOT_FOUND),
            detail="Certification not found",
        ) from exc

    return _category_response(category)


@router.get(
    "/questions",
    response_model=QuestionBankList,
)
def list_managed_questions(
    current_user: Annotated[
        User,
        Depends(get_current_user),
    ],
    session: Annotated[
        Session,
        Depends(get_session),
    ],
) -> QuestionBankList:
    records = list_question_bank(
        session,
        actor=current_user,
    )

    return QuestionBankList(
        items=[
            QuestionBankItem(
                question_id=(item.question_id),
                question_version_id=(item.question_version_id),
                version_number=(item.version_number),
                question_preview=(item.question_preview),
                certification_id=(item.certification_id),
                certification_name=(item.certification_name),
                category_id=(item.category_id),
                category_name=(item.category_name),
                difficulty=item.difficulty,
                question_type=(item.question_type),
                review_status=(item.review_status),
                publication_status=(item.publication_status),
                is_flagged=(item.is_flagged),
                created_by_id=(item.created_by_id),
                last_updated=(item.last_updated),
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
    current_user: Annotated[
        User,
        Depends(get_current_user),
    ],
    session: Annotated[
        Session,
        Depends(get_session),
    ],
) -> QuestionBankDetail:
    try:
        detail = get_question_bank_details(
            session,
            question_id,
            actor=current_user,
        )

    except QuestionBankNotFoundError as exc:
        raise HTTPException(
            status_code=(status.HTTP_404_NOT_FOUND),
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
    current_user: Annotated[
        User,
        Depends(get_current_user),
    ],
    session: Annotated[
        Session,
        Depends(get_session),
    ],
) -> QuestionBankDetail:
    try:
        detail = edit_question_draft(
            session,
            question_id,
            payload,
            actor=current_user,
        )

    except QuestionBankNotFoundError as exc:
        raise HTTPException(
            status_code=(status.HTTP_404_NOT_FOUND),
            detail="Question not found",
        ) from exc

    except QuestionPublishedRevisionForbiddenError as exc:
        raise HTTPException(
            status_code=(status.HTTP_403_FORBIDDEN),
            detail=str(exc),
        ) from exc

    except QuestionDraftNotEditableError as exc:
        raise HTTPException(
            status_code=(status.HTTP_409_CONFLICT),
            detail=str(exc),
        ) from exc

    except QuestionDraftScopeError as exc:
        raise HTTPException(
            status_code=(status.HTTP_422_UNPROCESSABLE_CONTENT),
            detail=str(exc),
        ) from exc

    return _question_detail_response(detail)


@router.post(
    "/questions/{question_id}/publish",
    response_model=QuestionBankDetail,
)
def publish_managed_question(
    question_id: UUID,
    administrator: Annotated[
        User,
        Depends(require_administrator),
    ],
    session: Annotated[
        Session,
        Depends(get_session),
    ],
) -> QuestionBankDetail:
    try:
        detail = publish_question_draft(
            session,
            question_id,
            actor=administrator,
        )

    except QuestionBankNotFoundError as exc:
        raise HTTPException(
            status_code=(status.HTTP_404_NOT_FOUND),
            detail="Question not found",
        ) from exc

    except QuestionDraftNotPublishableError as exc:
        raise HTTPException(
            status_code=(status.HTTP_409_CONFLICT),
            detail=str(exc),
        ) from exc

    return _question_detail_response(detail)


@router.post(
    "/questions/{question_id}/reject",
    response_model=QuestionBankDetail,
)
def reject_managed_question(
    question_id: UUID,
    payload: QuestionRejectionRequest,
    administrator: Annotated[
        User,
        Depends(require_administrator),
    ],
    session: Annotated[
        Session,
        Depends(get_session),
    ],
) -> QuestionBankDetail:
    try:
        detail = reject_question_draft(
            session,
            question_id,
            actor=administrator,
            review_note=(payload.review_note),
        )

    except QuestionBankNotFoundError as exc:
        raise HTTPException(
            status_code=(status.HTTP_404_NOT_FOUND),
            detail="Question not found",
        ) from exc

    except QuestionDraftNotRejectableError as exc:
        raise HTTPException(
            status_code=(status.HTTP_409_CONFLICT),
            detail=str(exc),
        ) from exc

    return _question_detail_response(detail)


@router.post(
    "/questions/{question_id}/retire",
    response_model=QuestionRetirementResponse,
)
def retire_managed_question(
    question_id: UUID,
    payload: QuestionRetirementRequest,
    _administrator: Annotated[
        User,
        Depends(require_administrator),
    ],
    session: Annotated[
        Session,
        Depends(get_session),
    ],
) -> QuestionRetirementResponse:
    _ = payload.confirm

    try:
        result = retire_question(
            session,
            question_id,
        )

    except QuestionRetirementNotFoundError as exc:
        raise HTTPException(
            status_code=(status.HTTP_404_NOT_FOUND),
            detail="Question not found",
        ) from exc

    except QuestionNotRetirableError as exc:
        raise HTTPException(
            status_code=(status.HTTP_409_CONFLICT),
            detail=str(exc),
        ) from exc

    return QuestionRetirementResponse(
        question_id=(result.question_id),
        retired_version_ids=list(result.retired_version_ids),
        already_retired=(result.already_retired),
    )


@router.post(
    "/questions",
    response_model=QuestionDraftCreated,
    status_code=status.HTTP_201_CREATED,
)
def create_draft_question(
    payload: QuestionDraftCreate,
    current_user: Annotated[
        User,
        Depends(get_current_user),
    ],
    session: Annotated[
        Session,
        Depends(get_session),
    ],
) -> QuestionDraftCreated:
    try:
        created = create_question_draft(
            session,
            payload,
            actor_id=current_user.id,
        )

    except QuestionDraftScopeError as exc:
        raise HTTPException(
            status_code=(status.HTTP_422_UNPROCESSABLE_CONTENT),
            detail=str(exc),
        ) from exc

    return QuestionDraftCreated(
        question_id=(created.question_id),
        question_version_id=(created.question_version_id),
        version_number=(created.version_number),
        review_status=(created.review_status),
        publication_status=(created.publication_status),
    )
