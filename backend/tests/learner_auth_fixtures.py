"""Account fixtures for HTTP tests whose exam/catalog services are doubles.

Use the real authentication dependency and a disposable SQLite users table.
Only explicitly issued test identities are inserted. The helper does not
change production authentication or replace the route's security dependency.
"""

from collections.abc import Iterator
from contextvars import ContextVar
from uuid import UUID

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, create_engine

from app.core.security import create_access_token
from app.db.session import get_session
from app.main import app
from app.models import User

STUB_LEARNER_ID = "11111111-1111-4111-8111-111111111111"
_active_engine: ContextVar[Engine | None] = ContextVar(
    "stub_learner_engine", default=None
)


@pytest.fixture
def stub_learner_database() -> Iterator[None]:
    """Provide real persisted account rows for service-double tests only."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    User.__table__.create(engine)

    def override_session() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    previous = app.dependency_overrides.get(get_session)
    app.dependency_overrides[get_session] = override_session
    active = _active_engine.set(engine)
    try:
        yield
    finally:
        _active_engine.reset(active)
        if previous is None:
            app.dependency_overrides.pop(get_session, None)
        else:
            app.dependency_overrides[get_session] = previous
        engine.dispose()


def issue_learner_token(subject: str) -> str:
    """Seed a signed test identity only inside the explicit SQLite fixture.

    Invalid subject strings remain invalid. Outside that fixture (including
    PostgreSQL integration tests) this only signs the supplied subject; the
    caller must have persisted the corresponding account already.
    """
    engine = _active_engine.get()
    try:
        identifier = UUID(subject)
    except (TypeError, ValueError, AttributeError):
        return create_access_token(subject)
    if engine is not None:
        with Session(engine) as session:
            if session.get(User, identifier) is None:
                session.add(
                    User(
                        id=identifier,
                        email=f"stub-{identifier.hex}@example.test",
                        role="learner",
                        is_verified=True,
                    )
                )
                session.commit()
    return create_access_token(subject)
