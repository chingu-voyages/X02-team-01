"""Role-protected administrative API routes."""

from typing import Annotated, Literal
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from sqlmodel import Session

from app.api.deps import (
    get_current_user,
    require_administrator,
    require_contributor_or_administrator,
)
from app.core.config import settings
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
    AdminQuestionImageOut,
    QuestionBankDetail,
    QuestionBankItem,
    QuestionBankList,
    QuestionDraftCreate,
    QuestionDraftCreated,
    QuestionDraftEdit,
    QuestionRejectionRequest,
)
from app.schemas.admin_user import (
    AdminUserOut,
    UserRoleChangeIn,
    UserRoleChangeOut,
    UsersPageOut,
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
from app.services.admin_question_bank_query_service import (
    query_question_bank,
)
from app.services.admin_question_image_service import (
    ManagedQuestionImage,
    QuestionImageLimitError,
    QuestionImageNotFoundError,
    QuestionImagePermissionError,
    QuestionImageStateError,
    add_question_image,
    remove_question_image,
    replace_question_image,
)
from app.services.admin_question_service import (
    QuestionBankDetails,
    QuestionBankNotAuthorizedError,
    QuestionBankNotFoundError,
    QuestionDraftNotEditableError,
    QuestionDraftNotPublishableError,
    QuestionDraftNotRejectableError,
    QuestionDraftScopeError,
    QuestionPublishedRevisionForbiddenError,
    QuestionReviewTransitionError,
    create_question_draft,
    edit_question_draft,
    get_question_bank_details,
    publish_question_draft,
    reject_question_draft,
    request_question_changes,
    start_question_review,
    submit_question_for_review,
)
from app.services.admin_user_service import (
    AdministratorRoleChangeError,
    SelfRoleChangeError,
    UserNotFoundError,
    change_role,
    list_users,
)
from app.services.media_url import resolve_media_url
from app.services.question_image_validation import (
    QuestionImageAltTextError,
    QuestionImageDimensionsError,
    QuestionImageInvalidContentError,
    QuestionImageTooLargeError,
    QuestionImageUnsupportedTypeError,
    validate_question_image,
)
from app.services.question_retirement_service import (
    QuestionNotRetirableError,
    QuestionRetirementNotFoundError,
    retire_question,
)
from app.services.r2_storage import (
    R2ConfigurationError,
    R2Storage,
    R2StorageError,
)

router = APIRouter(
    dependencies=[Depends(require_contributor_or_administrator)],
)


def get_r2_storage() -> R2Storage:
    """Resolve backend-only question-image storage."""

    try:
        return R2Storage()

    except R2ConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Question image storage is unavailable",
        ) from exc


async def _validated_question_image(
    *,
    file: UploadFile,
    alt_text: str,
):
    """Read and validate one uploaded question image."""

    try:
        content = await file.read(settings.max_question_image_bytes + 1)

    finally:
        await file.close()

    return validate_question_image(
        content=content,
        alt_text=alt_text,
    )


def _question_image_http_error(
    exc: Exception,
) -> HTTPException:
    if isinstance(
        exc,
        QuestionImageTooLargeError,
    ):
        return HTTPException(
            status_code=413,
            detail=str(exc),
        )

    if isinstance(
        exc,
        QuestionImageUnsupportedTypeError,
    ):
        return HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=str(exc),
        )

    if isinstance(
        exc,
        (
            QuestionImageInvalidContentError,
            QuestionImageDimensionsError,
            QuestionImageAltTextError,
        ),
    ):
        return HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        )

    if isinstance(
        exc,
        QuestionImageNotFoundError,
    ):
        return HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )

    if isinstance(
        exc,
        QuestionImagePermissionError,
    ):
        return HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        )

    if isinstance(
        exc,
        (
            QuestionImageLimitError,
            QuestionImageStateError,
        ),
    ):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        )

    if isinstance(
        exc,
        R2StorageError,
    ):
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Question image storage is unavailable",
        )

    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Unable to manage question image",
    )


def _question_image_response(
    image: ManagedQuestionImage,
) -> AdminQuestionImageOut:
    """Return safe management metadata without exposing storage keys."""

    return AdminQuestionImageOut(
        id=image.id,
        question_version_id=image.question_version_id,
        position=image.position,
        alt_text=image.alt_text,
        media_type=image.media_type,
        url=resolve_media_url(image.storage_key),
    )


def _category_response(
    category,
) -> AdminCategoryOut:
    return AdminCategoryOut(
        id=category.id,
        certification_id=category.certification_id,
        certification_name=category.certification_name,
        name=category.name,
        is_published=category.is_published,
    )


def _certification_response(
    certification,
) -> CertificationOut:
    return CertificationOut(
        id=certification.id,
        name=certification.name,
        code=certification.code,
        passing_threshold_pct=(certification.passing_threshold_pct),
        feedback_mode=certification.feedback_mode,
        is_published=certification.is_published,
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
        allows_multiple_answers=(detail.allows_multiple_answers),
        explanation=detail.explanation,
        review_status=detail.review_status,
        publication_status=detail.publication_status,
        review_note=detail.review_note,
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
        images=[
            AdminQuestionImageOut(
                id=image.id,
                question_version_id=(image.question_version_id),
                position=image.position,
                alt_text=image.alt_text,
                media_type=image.media_type,
                url=image.url,
            )
            for image in detail.images
        ],
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
            status_code=status.HTTP_409_CONFLICT,
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
            is_published=payload.is_published,
        )

    except CertificationNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
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
        certification_id=certification_id,
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
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Certification not found",
        ) from exc

    except CategoryNameConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
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
            is_published=payload.is_published,
        )

    except AdminCategoryNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found",
        ) from exc

    except CategoryCertificationNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
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
    search: str | None = None,
    certification_id: UUID | None = None,
    category_id: UUID | None = None,
    difficulty: Literal[
        "easy",
        "medium",
        "hard",
    ]
    | None = None,
    question_type: Literal[
        "multiple_choice",
        "short_answer",
    ]
    | None = None,
    review_status: Literal[
        "pending",
        "submitted",
        "in_review",
        "approved",
        "rejected",
    ]
    | None = None,
    publication_status: Literal[
        "draft",
        "active",
        "inactive",
        "retired",
    ]
    | None = None,
    author_email: str | None = None,
    has_image: bool | None = None,
    page: Annotated[
        int,
        Query(ge=1),
    ] = 1,
    page_size: Annotated[
        int | None,
        Query(
            ge=1,
            le=100,
        ),
    ] = None,
) -> QuestionBankList:
    result = query_question_bank(
        session,
        actor=current_user,
        search=search,
        certification_id=certification_id,
        category_id=category_id,
        difficulty=difficulty,
        question_type=question_type,
        review_status=review_status,
        author_email=author_email,
        publication_status=publication_status,
        has_image=has_image,
        page=page,
        page_size=page_size,
    )

    return QuestionBankList(
        items=[
            QuestionBankItem(
                question_id=item.question_id,
                question_version_id=(item.question_version_id),
                version_number=item.version_number,
                question_preview=item.question_preview,
                certification_id=(item.certification_id),
                certification_name=(item.certification_name),
                category_id=item.category_id,
                category_name=item.category_name,
                difficulty=item.difficulty,
                question_type=item.question_type,
                review_status=item.review_status,
                publication_status=(item.publication_status),
                is_flagged=item.is_flagged,
                has_image=item.has_image,
                created_by_id=item.created_by_id,
                last_updated=item.last_updated,
            )
            for item in result.items
        ],
        count=result.total,
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
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Question not found",
        ) from exc

    return _question_detail_response(detail)


@router.post(
    "/questions/{question_id}/images",
    response_model=AdminQuestionImageOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_managed_question_image(
    question_id: UUID,
    current_user: Annotated[
        User,
        Depends(get_current_user),
    ],
    session: Annotated[
        Session,
        Depends(get_session),
    ],
    storage: Annotated[
        R2Storage,
        Depends(get_r2_storage),
    ],
    file: Annotated[
        UploadFile,
        File(...),
    ],
    alt_text: Annotated[
        str,
        Form(...),
    ],
) -> AdminQuestionImageOut:
    try:
        validated = await _validated_question_image(
            file=file,
            alt_text=alt_text,
        )

        image = add_question_image(
            session,
            question_id=question_id,
            image=validated,
            actor=current_user,
            storage=storage,
        )

    except (
        QuestionImageTooLargeError,
        QuestionImageUnsupportedTypeError,
        QuestionImageInvalidContentError,
        QuestionImageDimensionsError,
        QuestionImageAltTextError,
        QuestionImageNotFoundError,
        QuestionImagePermissionError,
        QuestionImageLimitError,
        QuestionImageStateError,
        R2StorageError,
    ) as exc:
        raise _question_image_http_error(exc) from exc

    return _question_image_response(image)


@router.patch(
    "/questions/{question_id}/images/{image_id}",
    response_model=AdminQuestionImageOut,
)
async def replace_managed_question_image(
    question_id: UUID,
    image_id: UUID,
    current_user: Annotated[
        User,
        Depends(get_current_user),
    ],
    session: Annotated[
        Session,
        Depends(get_session),
    ],
    storage: Annotated[
        R2Storage,
        Depends(get_r2_storage),
    ],
    file: Annotated[
        UploadFile,
        File(...),
    ],
    alt_text: Annotated[
        str,
        Form(...),
    ],
) -> AdminQuestionImageOut:
    try:
        validated = await _validated_question_image(
            file=file,
            alt_text=alt_text,
        )

        image = replace_question_image(
            session,
            question_id=question_id,
            image_id=image_id,
            image=validated,
            actor=current_user,
            storage=storage,
        )

    except (
        QuestionImageTooLargeError,
        QuestionImageUnsupportedTypeError,
        QuestionImageInvalidContentError,
        QuestionImageDimensionsError,
        QuestionImageAltTextError,
        QuestionImageNotFoundError,
        QuestionImagePermissionError,
        QuestionImageLimitError,
        QuestionImageStateError,
        R2StorageError,
    ) as exc:
        raise _question_image_http_error(exc) from exc

    return _question_image_response(image)


@router.delete(
    "/questions/{question_id}/images/{image_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def remove_managed_question_image(
    question_id: UUID,
    image_id: UUID,
    current_user: Annotated[
        User,
        Depends(get_current_user),
    ],
    session: Annotated[
        Session,
        Depends(get_session),
    ],
    storage: Annotated[
        R2Storage,
        Depends(get_r2_storage),
    ],
) -> Response:
    try:
        remove_question_image(
            session,
            question_id=question_id,
            image_id=image_id,
            actor=current_user,
            storage=storage,
        )

    except (
        QuestionImageNotFoundError,
        QuestionImagePermissionError,
        QuestionImageStateError,
        R2StorageError,
    ) as exc:
        raise _question_image_http_error(exc) from exc

    return Response(status_code=status.HTTP_204_NO_CONTENT)


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
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Question not found",
        ) from exc

    except QuestionPublishedRevisionForbiddenError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
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
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Question not found",
        ) from exc

    except QuestionDraftNotPublishableError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
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
            review_note=payload.review_note,
        )

    except QuestionBankNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Question not found",
        ) from exc

    except QuestionDraftNotRejectableError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
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
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Question not found",
        ) from exc

    except QuestionNotRetirableError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc

    return QuestionRetirementResponse(
        question_id=result.question_id,
        retired_version_ids=list(result.retired_version_ids),
        already_retired=result.already_retired,
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


def _admin_user_response(
    user: User,
) -> AdminUserOut:
    return AdminUserOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        is_verified=user.is_verified,
        created_at=user.created_at,
    )


@router.get(
    "/users",
    response_model=UsersPageOut,
)
def list_accounts(
    actor: Annotated[
        User,
        Depends(require_administrator),
    ],
    session: Annotated[
        Session,
        Depends(get_session),
    ],
    q: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> UsersPageOut:
    """Locate accounts for the Users & Access screen."""

    users, total = list_users(
        session,
        actor=actor,
        q=q,
        limit=limit,
        offset=offset,
    )

    return UsersPageOut(
        items=[_admin_user_response(user) for user in users],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.patch(
    "/users/{user_id}/role",
    response_model=UserRoleChangeOut,
)
def change_account_role(
    user_id: UUID,
    payload: UserRoleChangeIn,
    actor: Annotated[
        User,
        Depends(require_administrator),
    ],
    session: Annotated[
        Session,
        Depends(get_session),
    ],
) -> UserRoleChangeOut:
    """Move an account between Learner and Contributor."""

    try:
        target, audit = change_role(
            session,
            actor=actor,
            target_id=user_id,
            new_role=payload.role,
        )

    except UserNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "USER_NOT_FOUND",
                "message": str(exc),
            },
        ) from exc

    except AdministratorRoleChangeError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "CANNOT_CHANGE_ADMIN_ROLE",
                "message": str(exc),
            },
        ) from exc

    except SelfRoleChangeError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "CANNOT_CHANGE_OWN_ROLE",
                "message": str(exc),
            },
        ) from exc

    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc

    return UserRoleChangeOut(
        user=_admin_user_response(target),
        action=audit.action,
        role_before=audit.role_before,
        role_after=audit.role_after,
        changed_at=audit.created_at,
    )


@router.post("/questions/{question_id}/submit", response_model=QuestionBankDetail)
def submit_question(
    question_id: UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> QuestionBankDetail:
    """JHEP-119 AC1: the owning Contributor submits their valid Draft
    toward review. Submission never publishes."""
    try:
        detail = submit_question_for_review(session, question_id, actor=current_user)
        return _question_detail_response(detail)
    except QuestionBankNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except QuestionBankNotAuthorizedError as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except QuestionReviewTransitionError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/questions/{question_id}/start-review", response_model=QuestionBankDetail)
def start_question_review_endpoint(
    question_id: UUID,
    actor: Annotated[User, Depends(require_administrator)],
    session: Annotated[Session, Depends(get_session)],
) -> QuestionBankDetail:
    """JHEP-119 AC2: Submitted -> In Review, stamped with the reviewer."""
    try:
        detail = start_question_review(session, question_id, actor=actor)
        return _question_detail_response(detail)
    except QuestionBankNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except QuestionReviewTransitionError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post(
    "/questions/{question_id}/request-changes", response_model=QuestionBankDetail
)
def request_question_changes_endpoint(
    question_id: UUID,
    payload: QuestionRejectionRequest,
    actor: Annotated[User, Depends(require_administrator)],
    session: Annotated[Session, Depends(get_session)],
) -> QuestionBankDetail:
    """JHEP-119 AC3: In Review -> the author's editable Draft, with the
    required reason kept as feedback."""
    try:
        detail = request_question_changes(
            session, question_id, actor=actor, review_note=payload.review_note
        )
        return _question_detail_response(detail)
    except QuestionBankNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except QuestionReviewTransitionError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc
