from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel


class Certification(SQLModel, table=True):
    __tablename__ = "certifications"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    name: str = Field(max_length=255, nullable=False)
    code: str = Field(max_length=50, unique=True, nullable=False)
