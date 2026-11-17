"""Question-image management for Contributors and Administrators."""

from dataclasses import dataclass
from uuid import UUID, uuid4

from sqlmodel import Session, select

from app.core.roles import UserRole
from app.models.answer_option import AnswerOption
from app.models.question import Question
from app.models.question_image import QuestionImage
from app.models.question_version import QuestionVersion
from app.models.text_answer_key import TextAnswerKey
from app.models.user import User
from app.services.question_image_validation import (
    ValidatedQuestionImage,
)
from app.services.r2_storage import (
    R2Storage,
)


class QuestionImageNotFoundError(LookupError):
    """Question or requested image is unavailable to the current actor."""


class QuestionImagePermissionError(PermissionError):
    """The actor cannot alter media on this question."""


class QuestionImageStateError(ValueError):
    """The question cannot accept a media change in its current state."""


class QuestionImageLimitError(ValueError):
    """The current MVP permits one image per question version."""


@dataclass(frozen=True)
class ManagedQuestionImage:
    id: UUID
    question_version_id: UUID
    storage_key: str
    alt_text: str
    media_type: str
    position: int


def _question_visible_to_actor(
    question: Question,
    actor: User,
) -> bool:
    if actor.role == UserRole.ADMINISTRATOR:
        return True

    return actor.role == UserRole.CONTRIBUTOR and question.created_by_id == actor.id


def _latest_version(
    session: Session,
    question_id: UUID,
) -> QuestionVersion:
    version = session.exec(
        select(QuestionVersion)
        .where(QuestionVersion.question_id == question_id)
        .order_by(QuestionVersion.version_number.desc())
    ).first()

    if version is None:
        raise QuestionImageNotFoundError("Question version not found")

    return version


def _copy_answer_configuration(
    session: Session,
    *,
    source_version: QuestionVersion,
    target_version: QuestionVersion,
) -> None:
    if source_version.question_type == "multiple_choice":
        options = session.exec(
            select(AnswerOption)
            .where(AnswerOption.question_version_id == source_version.id)
            .order_by(AnswerOption.position)
        ).all()

        for option in options:
            session.add(
                AnswerOption(
                    question_version_id=(target_version.id),
                    option_text=option.option_text,
                    is_correct=option.is_correct,
                    position=option.position,
                )
            )

        return

    answer_key = session.exec(
        select(TextAnswerKey).where(
            TextAnswerKey.question_version_id == source_version.id
        )
    ).first()

    if answer_key is not None:
        session.add(
            TextAnswerKey(
                question_version_id=(target_version.id),
                expected_answer=(answer_key.expected_answer),
            )
        )


def _copy_images(
    session: Session,
    *,
    source_version: QuestionVersion,
    target_version: QuestionVersion,
) -> None:
    images = session.exec(
        select(QuestionImage)
        .where(QuestionImage.question_version_id == source_version.id)
        .order_by(QuestionImage.position)
    ).all()

    for image in images:
        session.add(
            QuestionImage(
                question_version_id=(target_version.id),
                storage_key=image.storage_key,
                alt_text=image.alt_text,
                media_type=image.media_type,
                position=image.position,
            )
        )


def _create_media_revision(
    session: Session,
    *,
    question: Question,
    active_version: QuestionVersion,
    actor: User,
) -> QuestionVersion:
    """Clone a published version before changing its media."""

    revision = QuestionVersion(
        question_id=question.id,
        version_number=(active_version.version_number + 1),
        question_text=(active_version.question_text),
        question_type=(active_version.question_type),
        allows_multiple_answers=(active_version.allows_multiple_answers),
        explanation=active_version.explanation,
        review_status="pending",
        publication_status="draft",
        is_flagged=False,
        submitted_by_id=actor.id,
    )

    session.add(revision)
    session.flush()

    _copy_answer_configuration(
        session,
        source_version=active_version,
        target_version=revision,
    )

    _copy_images(
        session,
        source_version=active_version,
        target_version=revision,
    )

    session.flush()

    return revision


def _editable_version(
    session: Session,
    *,
    question: Question,
    actor: User,
) -> QuestionVersion:
    if not _question_visible_to_actor(
        question,
        actor,
    ):
        raise QuestionImageNotFoundError("Question not found")

    version = _latest_version(
        session,
        question.id,
    )

    if version.publication_status == "active":
        if actor.role != UserRole.ADMINISTRATOR:
            raise QuestionImagePermissionError(
                "Only administrators can revise published question images"
            )

        return _create_media_revision(
            session,
            question=question,
            active_version=version,
            actor=actor,
        )

    if version.publication_status != "draft":
        raise QuestionImageStateError(
            "Only draft or active questions can change images"
        )

    return version


def _storage_key(
    *,
    question_version_id: UUID,
    extension: str,
) -> str:
    return f"questions/{question_version_id}/{uuid4()}.{extension}"


def _is_storage_key_referenced(
    session: Session,
    *,
    storage_key: str,
) -> bool:
    return (
        session.exec(
            select(QuestionImage.id)
            .where(QuestionImage.storage_key == storage_key)
            .limit(1)
        ).first()
        is not None
    )


def add_question_image(
    session: Session,
    *,
    question_id: UUID,
    image: ValidatedQuestionImage,
    actor: User,
    storage: R2Storage,
) -> ManagedQuestionImage:
    question = session.get(
        Question,
        question_id,
    )

    if question is None:
        raise QuestionImageNotFoundError("Question not found")

    uploaded_key: str | None = None

    try:
        version = _editable_version(
            session,
            question=question,
            actor=actor,
        )

        existing = session.exec(
            select(QuestionImage).where(QuestionImage.question_version_id == version.id)
        ).first()

        if existing is not None:
            raise QuestionImageLimitError(
                "Only one question image is supported in this release"
            )

        uploaded_key = _storage_key(
            question_version_id=version.id,
            extension=image.extension,
        )

        storage.upload(
            key=uploaded_key,
            content=image.content,
            media_type=image.media_type,
        )

        record = QuestionImage(
            question_version_id=version.id,
            storage_key=uploaded_key,
            alt_text=image.alt_text,
            media_type=image.media_type,
            position=1,
        )

        session.add(record)
        session.commit()
        session.refresh(record)

    except Exception:
        session.rollback()

        if uploaded_key is not None:
            try:
                storage.delete(
                    key=uploaded_key,
                )
            except Exception:
                pass

        raise

    return ManagedQuestionImage(
        id=record.id,
        question_version_id=(record.question_version_id),
        storage_key=record.storage_key,
        alt_text=record.alt_text,
        media_type=record.media_type,
        position=record.position,
    )


def replace_question_image(
    session: Session,
    *,
    question_id: UUID,
    image_id: UUID,
    image: ValidatedQuestionImage,
    actor: User,
    storage: R2Storage,
) -> ManagedQuestionImage:
    question = session.get(
        Question,
        question_id,
    )

    if question is None:
        raise QuestionImageNotFoundError("Question not found")

    new_key: str | None = None
    old_key: str | None = None

    try:
        version = _editable_version(
            session,
            question=question,
            actor=actor,
        )

        record = session.exec(
            select(QuestionImage).where(
                QuestionImage.id == image_id,
                QuestionImage.question_version_id == version.id,
            )
        ).first()

        # Published revisions copy the image row
        # under a new image ID. Allow callers to
        # identify the image from the previous
        # active version by matching its position.
        if record is None:
            record = session.exec(
                select(QuestionImage).where(
                    QuestionImage.question_version_id == version.id,
                    QuestionImage.position == 1,
                )
            ).first()

        if record is None:
            raise QuestionImageNotFoundError("Question image not found")

        old_key = record.storage_key

        new_key = _storage_key(
            question_version_id=version.id,
            extension=image.extension,
        )

        storage.upload(
            key=new_key,
            content=image.content,
            media_type=image.media_type,
        )

        record.storage_key = new_key
        record.alt_text = image.alt_text
        record.media_type = image.media_type

        session.add(record)
        session.commit()
        session.refresh(record)

    except Exception:
        session.rollback()

        if new_key is not None:
            try:
                storage.delete(
                    key=new_key,
                )
            except Exception:
                pass

        raise

    if (
        old_key
        and old_key != new_key
        and not _is_storage_key_referenced(
            session,
            storage_key=old_key,
        )
    ):
        try:
            storage.delete(
                key=old_key,
            )
        except Exception:
            # The DB now points safely at the new image.
            # Orphan cleanup can retry later.
            pass

    return ManagedQuestionImage(
        id=record.id,
        question_version_id=(record.question_version_id),
        storage_key=record.storage_key,
        alt_text=record.alt_text,
        media_type=record.media_type,
        position=record.position,
    )


def remove_question_image(
    session: Session,
    *,
    question_id: UUID,
    image_id: UUID,
    actor: User,
    storage: R2Storage,
) -> None:
    question = session.get(
        Question,
        question_id,
    )

    if question is None:
        raise QuestionImageNotFoundError("Question not found")

    old_key: str | None = None

    try:
        version = _editable_version(
            session,
            question=question,
            actor=actor,
        )

        record = session.exec(
            select(QuestionImage).where(
                QuestionImage.id == image_id,
                QuestionImage.question_version_id == version.id,
            )
        ).first()

        if record is None:
            record = session.exec(
                select(QuestionImage).where(
                    QuestionImage.question_version_id == version.id,
                    QuestionImage.position == 1,
                )
            ).first()

        if record is None:
            raise QuestionImageNotFoundError("Question image not found")

        old_key = record.storage_key

        session.delete(record)
        session.commit()

    except Exception:
        session.rollback()
        raise

    if old_key and not _is_storage_key_referenced(
        session,
        storage_key=old_key,
    ):
        try:
            storage.delete(
                key=old_key,
            )
        except Exception:
            pass
