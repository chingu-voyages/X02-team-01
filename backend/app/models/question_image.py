"""Version-pinned question images. Bytes live in object storage, not Postgres."""

from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, Text, UniqueConstraint
from sqlmodel import Field, SQLModel


class QuestionImage(SQLModel, table=True):
    __tablename__ = "question_images"

    __table_args__ = (
        UniqueConstraint(
            "question_version_id",
            "position",
            name="uq_question_images_version_position",
        ),
        CheckConstraint("position > 0", name="ck_question_images_position"),
        CheckConstraint(
            "length(trim(storage_key)) > 0",
            name="ck_question_images_storage_key",
        ),
        CheckConstraint(
            "length(trim(alt_text)) > 0",
            name="ck_question_images_alt_text",
        ),
        CheckConstraint(
            "media_type IN ('image/png', 'image/jpeg', 'image/webp')",
            name="ck_question_images_media_type",
        ),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    question_version_id: UUID = Field(
        foreign_key="question_versions.id", nullable=False, index=True
    )
    storage_key: str = Field(sa_type=Text, nullable=False)
    alt_text: str = Field(sa_type=Text, nullable=False)
    media_type: str = Field(max_length=32, nullable=False)
    position: int = Field(nullable=False)
