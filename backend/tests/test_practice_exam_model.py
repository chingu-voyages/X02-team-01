"""JHEP-126: database invariants for the new practice exam lifecycle."""

from uuid import uuid4

import pytest
from sqlalchemy import event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.models import Category, Certification, PracticeExam


@pytest.fixture
def exam_database():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(dbapi_connection, _connection_record):
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    SQLModel.metadata.create_all(
        engine,
        tables=[
            Certification.__table__,
            Category.__table__,
            PracticeExam.__table__,
        ],
    )
    try:
        yield engine
    finally:
        engine.dispose()


def _seed_scope(session: Session):
    certification = Certification(
        name="Computer Science",
        code=f"CS-{uuid4().hex[:10]}",
        passing_threshold_pct=70,
        is_published=True,
    )
    session.add(certification)
    session.flush()

    category = Category(
        certification_id=certification.id,
        name="Programming Fundamentals",
        is_published=True,
    )
    session.add(category)
    session.flush()
    return certification, category


def test_new_exam_is_draft_with_no_implicit_question_count(exam_database):
    with Session(exam_database) as session:
        certification, category = _seed_scope(session)
        exam = PracticeExam(
            name="Computer Science Practice",
            certification_id=certification.id,
            category_id=category.id,
        )
        session.add(exam)
        session.commit()
        session.refresh(exam)

        assert exam.status == "draft"
        assert exam.question_count is None
        assert exam.certification_id == certification.id
        assert exam.category_id == category.id


@pytest.mark.parametrize("count", [1, 100])
def test_question_count_inclusive_boundaries_are_accepted(exam_database, count):
    with Session(exam_database) as session:
        certification, category = _seed_scope(session)
        session.add(
            PracticeExam(
                name="Science Practice",
                certification_id=certification.id,
                category_id=category.id,
                question_count=count,
            )
        )
        session.commit()


@pytest.mark.parametrize("count", [0, -1, 101])
def test_invalid_question_count_is_rejected_by_database(exam_database, count):
    with Session(exam_database) as session:
        certification, category = _seed_scope(session)
        session.add(
            PracticeExam(
                name="Science Practice",
                certification_id=certification.id,
                category_id=category.id,
                question_count=count,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()


def test_invalid_status_is_rejected_by_database(exam_database):
    with Session(exam_database) as session:
        certification, category = _seed_scope(session)
        session.add(
            PracticeExam(
                name="Science Practice",
                certification_id=certification.id,
                category_id=category.id,
                status="live-now",
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()


def test_category_must_belong_to_its_certification(exam_database):
    with Session(exam_database) as session:
        _, category = _seed_scope(session)
        another = Certification(
            name="Another Certification",
            code=f"DIFF-{uuid4().hex[:10]}",
            passing_threshold_pct=75,
        )
        session.add(another)
        session.flush()
        session.add(
            PracticeExam(
                name="Incorrect Scope",
                certification_id=another.id,
                category_id=category.id,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()


def test_same_category_cannot_have_duplicate_exam_names(exam_database):
    with Session(exam_database) as session:
        certification, category = _seed_scope(session)
        session.add_all(
            [
                PracticeExam(
                    name="Science Practice",
                    certification_id=certification.id,
                    category_id=category.id,
                ),
                PracticeExam(
                    name="Science Practice",
                    certification_id=certification.id,
                    category_id=category.id,
                ),
            ]
        )
        with pytest.raises(IntegrityError):
            session.commit()
