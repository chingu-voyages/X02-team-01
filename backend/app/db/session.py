from collections.abc import Generator

from sqlmodel import Session, create_engine

from app.core.config import settings

# Shared database engine
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
)


# Database session dependency
def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session
