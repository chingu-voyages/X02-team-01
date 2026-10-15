from logging.config import fileConfig

from sqlmodel import SQLModel

from alembic import context
from app.core.config import settings
from app.db.session import engine

# Alembic configuration
config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# SQLModel metadata for future migrations
target_metadata = SQLModel.metadata


def run_migrations_offline() -> None:
    """Run migrations without a database connection."""
    context.configure(
        url=settings.database_url.render_as_string(hide_password=False),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations using the database connection."""
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
