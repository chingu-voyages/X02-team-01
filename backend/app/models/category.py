from uuid import UUID, uuid4

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel


class Category(SQLModel, table=True):
    __tablename__ = "categories"

    __table_args__ = (
        UniqueConstraint(
            "certification_id",
            "name",
            name="uq_categories_certification_name",
        ),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    certification_id: UUID = Field(
        foreign_key="certifications.id",
        nullable=False,
    )
    name: str = Field(max_length=255, nullable=False)
