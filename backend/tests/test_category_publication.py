"""Publication model tests using only disposable, in-memory catalog tables."""

from collections.abc import Iterator
from uuid import uuid4

import pytest
from sqlalchemy import event, text
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, SQLModel, create_engine

from app.models.category import Category
from app.models.certification import Certification


@pytest.fixture
def catalog_session() -> Iterator[Session]:
    # Deliberately do not create every application table: some use PostgreSQL
    # features. These tests need only certifications and categories.
    engine = create_engine("sqlite://")

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _connection_record):
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    SQLModel.metadata.create_all(
        engine,
        tables=[Certification.__table__, Category.__table__],
    )
    try:
        with Session(engine) as session:
            yield session
    finally:
        engine.dispose()


@pytest.fixture
def certification(catalog_session: Session) -> Certification:
    row = Certification(
        name="Agile Practice",
        code="AGILE-TEST",
        passing_threshold_pct=70,
    )
    catalog_session.add(row)
    catalog_session.commit()
    catalog_session.refresh(row)
    return row


def test_new_category_is_unpublished_before_persistence():
    category = Category(certification_id=uuid4(), name="Agile Fundamentals")

    assert category.is_published is False


def test_orm_default_is_persisted(catalog_session, certification):
    category = Category(
        certification_id=certification.id,
        name="Agile Fundamentals",
    )
    category_id = category.id
    catalog_session.add(category)
    catalog_session.commit()
    catalog_session.expunge_all()

    stored = catalog_session.get(Category, category_id)

    assert stored is not None
    assert stored.is_published is False


@pytest.mark.parametrize("published", [False, True])
def test_explicit_publication_is_persisted(catalog_session, certification, published):
    category = Category(
        certification_id=certification.id,
        name="Révision — méthodes agiles",
        is_published=published,
    )
    category_id = category.id
    catalog_session.add(category)
    catalog_session.commit()
    catalog_session.expunge_all()

    stored = catalog_session.get(Category, category_id)

    assert stored is not None
    assert stored.is_published is published
    assert stored.name == "Révision — méthodes agiles"


def test_raw_insert_uses_database_default(catalog_session, certification):
    category_id = uuid4()
    # A raw INSERT bypasses SQLModel/SQLAlchemy's Python-side default.
    catalog_session.execute(
        text(
            "INSERT INTO categories (id, certification_id, name) "
            "VALUES (:id, :certification_id, :name)"
        ),
        {
            "id": category_id.hex,
            "certification_id": certification.id.hex,
            "name": "Raw insert",
        },
    )
    catalog_session.commit()

    stored = catalog_session.get(Category, category_id)

    assert stored is not None
    assert stored.is_published is False


def test_publication_can_be_revoked(catalog_session, certification):
    category = Category(
        certification_id=certification.id,
        name="Temporary publication",
        is_published=True,
    )
    catalog_session.add(category)
    catalog_session.commit()

    category.is_published = False
    catalog_session.add(category)
    catalog_session.commit()
    catalog_session.refresh(category)

    assert category.is_published is False


def test_database_rejects_null_publication(catalog_session, certification):
    category = Category(
        certification_id=certification.id,
        name="Null protection",
    )
    catalog_session.add(category)
    catalog_session.commit()

    # UPDATE avoids ORM insert-default handling of None; this tests NOT NULL.
    with pytest.raises(IntegrityError):
        catalog_session.execute(
            text("UPDATE categories SET is_published = NULL WHERE id = :id"),
            {"id": category.id.hex},
        )
        catalog_session.commit()
    catalog_session.rollback()


def test_existing_name_uniqueness_is_preserved(catalog_session, certification):
    catalog_session.add_all(
        [
            Category(
                certification_id=certification.id,
                name="Duplicate name",
                is_published=published,
            )
            for published in (False, True)
        ]
    )

    with pytest.raises(IntegrityError):
        catalog_session.commit()
    catalog_session.rollback()
