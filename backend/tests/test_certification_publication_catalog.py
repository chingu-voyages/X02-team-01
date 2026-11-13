from collections.abc import Iterator
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import (
    Session,
    SQLModel,
    create_engine,
)

from app.models import (
    AnswerOption,
    Category,
    Certification,
    Question,
    QuestionVersion,
    User,
)
from app.repositories.category_repository import (
    SQLModelCategoryRepository,
)


@pytest.fixture
def session() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://",
        connect_args={
            "check_same_thread": False,
        },
        poolclass=StaticPool,
    )

    SQLModel.metadata.create_all(
        engine,
        tables=[
            User.__table__,
            Certification.__table__,
            Category.__table__,
            Question.__table__,
            QuestionVersion.__table__,
            AnswerOption.__table__,
        ],
    )

    try:
        with Session(engine) as database_session:
            yield database_session
    finally:
        engine.dispose()


def test_unpublished_certification_hides_category(
    session: Session,
):
    author = User(
        email=(f"{uuid4()}@example.test"),
    )

    session.add(author)
    session.flush()

    certification = Certification(
        name="Hidden Certification",
        code="HIDDEN-1",
        passing_threshold_pct=70,
        feedback_mode="immediate",
        is_published=False,
    )

    session.add(certification)
    session.flush()

    category = Category(
        certification_id=(certification.id),
        name="Visible Category",
        is_published=True,
    )

    session.add(category)
    session.flush()

    question = Question(
        certification_id=(certification.id),
        category_id=category.id,
        difficulty="easy",
        created_by_id=author.id,
    )

    session.add(question)
    session.flush()

    version = QuestionVersion(
        question_id=question.id,
        version_number=1,
        question_text="Example question",
        question_type="multiple_choice",
        allows_multiple_answers=False,
        review_status="approved",
        publication_status="active",
        is_flagged=False,
        submitted_by_id=author.id,
        reviewed_by_id=author.id,
        reviewed_at=datetime.now(UTC),
    )

    session.add(version)
    session.flush()

    session.add_all(
        [
            AnswerOption(
                question_version_id=(version.id),
                position=1,
                option_text="Correct",
                is_correct=True,
            ),
            AnswerOption(
                question_version_id=(version.id),
                position=2,
                option_text="Incorrect",
                is_correct=False,
            ),
        ]
    )

    session.commit()

    repository = SQLModelCategoryRepository(session)

    assert repository.list_available() == []

    certification.is_published = True

    session.add(certification)
    session.commit()

    results = repository.list_available()

    assert len(results) == 1

    assert results[0].id == category.id
