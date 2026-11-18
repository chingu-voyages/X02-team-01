"""JHEP-29 exam service: fast unit tests and opt-in PostgreSQL integration."""

import os
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, SQLModel, select

from app import models  # noqa: F401
from app.db.session import engine
from app.models import (
    AnswerOption,
    Category,
    Certification,
    ExamAttempt,
    ExamAttemptQuestion,
    Question,
    QuestionVersion,
    User,
)
from app.repositories.question_repository import ExamQuestionSelection
from app.services.exam_service import (
    AttemptInProgressError,
    CategoryUnavailableError,
    CertificationNotFoundError,
    ExamService,
    InsufficientQuestionsError,
    InvalidCategoryError,
    InvalidQuestionCountError,
    InvalidQuestionSelectionError,
    LearnerNotFoundError,
    MissingThresholdError,
)


class RecordingSession:
    """A fast test double; it tracks writes, commits, and rollbacks."""

    def __init__(self, learner_id, certification_id, fail_on=None):
        self.learner_id = learner_id
        self.certification_id = certification_id
        self.cert_threshold = 70
        self.category_id = None
        self.category_published = True
        self.active_attempt = None  # JHEP-28: a live in-progress attempt, if any
        self.fail_on = fail_on
        self.added = []
        self.commits = 0
        self.rollbacks = 0

    def exec(self, statement):
        """Single-column/entity selects produce row objects; the duplicate-
        start guard reads `.first()` only, so a row stub is enough."""
        return SimpleNamespace(first=lambda: self.active_attempt)

    def get(self, model, identifier):
        if model is User and identifier == self.learner_id:
            return object()
        if model is Certification and identifier == self.certification_id:
            return SimpleNamespace(
                passing_threshold_pct=self.cert_threshold,
                feedback_mode="deferred",
            )
        if model is Category and identifier == self.category_id:
            return SimpleNamespace(
                certification_id=self.certification_id,
                is_published=self.category_published,
            )
        return None

    def add(self, value):
        self.added.append(value)

    def add_all(self, values):
        self.added.extend(values)

    def flush(self):
        if self.fail_on == "flush":
            raise RuntimeError("simulated database flush failure")

    def commit(self):
        if self.fail_on == "commit":
            raise RuntimeError("simulated database commit failure")
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1
        self.added.clear()


class FixedSelector:
    """Return selections in a known order, regardless of randomness."""

    def __init__(self, selections):
        self.selections = selections
        self.calls = []

    def select_random_eligible(
        self,
        certification_id,
        question_count,
        category_id=None,
    ):
        if category_id is None:
            self.calls.append((certification_id, question_count))
        else:
            self.calls.append((certification_id, question_count, category_id))
        return self.selections


def selections(count):
    return [
        ExamQuestionSelection(question_id=uuid4(), question_version_id=uuid4())
        for _ in range(count)
    ]


def test_creates_attempt_with_stable_order():
    learner_id, certification_id = uuid4(), uuid4()
    session = RecordingSession(learner_id, certification_id)
    selected = selections(3)
    selector = FixedSelector(selected)

    result = ExamService(session, selector).create_exam(
        learner_id=learner_id,
        certification_id=certification_id,
        question_count=3,
    )

    assert selector.calls == [(certification_id, 3)]
    assert session.commits == 1
    assert session.rollbacks == 0
    assert len(session.added) == 4

    attempt = session.added[0]
    assert isinstance(attempt, ExamAttempt)
    assert attempt.id == result.attempt_id
    assert attempt.user_id == learner_id
    assert attempt.certification_id == certification_id
    assert attempt.status == "in_progress"
    assert attempt.current_position == 1
    assert attempt.question_count == 3
    # JHEP-35 AC3: the threshold snapshot is recorded when the attempt is created.
    assert attempt.passing_threshold_pct == 70

    assignments = session.added[1:]
    assert all(isinstance(item, ExamAttemptQuestion) for item in assignments)
    assert [item.position for item in assignments] == [1, 2, 3]
    assert [item.question_id for item in assignments] == [
        item.question_id for item in selected
    ]
    assert [item.question_version_id for item in assignments] == [
        item.question_version_id for item in selected
    ]
    assert all(item.attempt_id == attempt.id for item in assignments)


@pytest.mark.parametrize("count", [0, -1, -100, True, "3", 1.5, None])
def test_rejects_invalid_count(count):
    learner_id, certification_id = uuid4(), uuid4()
    session = RecordingSession(learner_id, certification_id)
    selector = FixedSelector(selections(3))

    with pytest.raises(InvalidQuestionCountError):
        ExamService(session, selector).create_exam(
            learner_id=learner_id,
            certification_id=certification_id,
            question_count=count,
        )
    assert session.added == []
    assert session.commits == 0
    assert selector.calls == []


def test_rejects_nonexistent_learner():
    session = RecordingSession(uuid4(), uuid4())
    with pytest.raises(LearnerNotFoundError):
        ExamService(session, FixedSelector(selections(1))).create_exam(
            learner_id=uuid4(),
            certification_id=session.certification_id,
            question_count=1,
        )
    assert session.added == []
    assert session.rollbacks == 1


def test_rejects_nonexistent_certification():
    session = RecordingSession(uuid4(), uuid4())
    with pytest.raises(CertificationNotFoundError):
        ExamService(session, FixedSelector(selections(1))).create_exam(
            learner_id=session.learner_id,
            certification_id=uuid4(),
            question_count=1,
        )
    assert session.added == []
    assert session.rollbacks == 1


def test_rejects_certification_without_threshold():
    session = RecordingSession(uuid4(), uuid4())
    session.cert_threshold = None

    with pytest.raises(MissingThresholdError):
        ExamService(session, FixedSelector(selections(1))).create_exam(
            learner_id=session.learner_id,
            certification_id=session.certification_id,
            question_count=1,
        )
    assert session.added == []
    assert session.rollbacks == 1


def test_insufficient_pool_creates_no_attempt():
    session = RecordingSession(uuid4(), uuid4())
    with pytest.raises(InsufficientQuestionsError) as exc:
        ExamService(session, FixedSelector(selections(2))).create_exam(
            learner_id=session.learner_id,
            certification_id=session.certification_id,
            question_count=5,
        )
    assert exc.value.requested == 5
    assert exc.value.available == 2
    assert session.added == []
    assert session.commits == 0
    assert session.rollbacks == 1


def test_rejects_duplicate_parent_questions():
    session = RecordingSession(uuid4(), uuid4())
    question_id = uuid4()
    selector = FixedSelector(
        [
            ExamQuestionSelection(question_id, uuid4()),
            ExamQuestionSelection(question_id, uuid4()),
        ]
    )
    with pytest.raises(InvalidQuestionSelectionError):
        ExamService(session, selector).create_exam(
            learner_id=session.learner_id,
            certification_id=session.certification_id,
            question_count=2,
        )
    assert session.added == []
    assert session.rollbacks == 1


def test_rejects_selector_returning_too_many_questions():
    session = RecordingSession(uuid4(), uuid4())
    with pytest.raises(InvalidQuestionSelectionError):
        ExamService(session, FixedSelector(selections(3))).create_exam(
            learner_id=session.learner_id,
            certification_id=session.certification_id,
            question_count=2,
        )
    assert session.added == []
    assert session.rollbacks == 1


@pytest.mark.parametrize("failure_stage", ["flush", "commit"])
def test_database_error_rolls_back(failure_stage):
    session = RecordingSession(uuid4(), uuid4(), fail_on=failure_stage)
    with pytest.raises(RuntimeError, match="simulated database"):
        ExamService(session, FixedSelector(selections(2))).create_exam(
            learner_id=session.learner_id,
            certification_id=session.certification_id,
            question_count=2,
        )
    assert session.commits == 0
    assert session.rollbacks == 1
    assert session.added == []


@pytest.fixture
def postgres_session():
    """Use an isolated temporary schema on LOCAL PostgreSQL only."""
    if os.getenv("RUN_DB_INTEGRATION") != "1":
        pytest.skip("PostgreSQL integration tests are opt-in")
    if engine.url.get_backend_name() != "postgresql":
        pytest.fail("PostgreSQL is required")
    if engine.url.host not in ("localhost", "127.0.0.1", None):
        pytest.fail("Tests must use local PostgreSQL")

    schema = f"jhep29_test_{uuid4().hex[:12]}"
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
            scoped = connection.execution_options(schema_translate_map={None: schema})
            SQLModel.metadata.create_all(scoped)
            # SAVEPOINTs let service.rollback() leave the fixture's outer
            # transaction (and temporary schema) intact.
            with Session(
                bind=scoped, join_transaction_mode="create_savepoint"
            ) as session:
                yield session
        finally:
            transaction.rollback()


def seed_postgres_exam_bank(session, question_count=3):
    learner = User(email=f"learner-{uuid4().hex}@example.com")
    certification = Certification(
        name="Test Exam Certification",
        code=uuid4().hex[:10],
        passing_threshold_pct=70,
    )
    session.add_all([learner, certification])
    session.flush()

    for i in range(question_count):
        question = Question(
            certification_id=certification.id,
            difficulty="easy",
            created_by_id=learner.id,
        )
        session.add(question)
        session.flush()

        version = QuestionVersion(
            question_id=question.id,
            version_number=1,
            question_text=f"Question number {i + 1}?",
            question_type="multiple_choice",
            review_status="approved",
            publication_status="active",
            submitted_by_id=learner.id,
            reviewed_by_id=learner.id,
            reviewed_at=datetime.now(UTC),
        )
        session.add(version)
        session.flush()
        session.add_all(
            [
                AnswerOption(
                    question_version_id=version.id,
                    position=1,
                    option_text="A",
                    is_correct=True,
                ),
                AnswerOption(
                    question_version_id=version.id,
                    position=2,
                    option_text="B",
                    is_correct=False,
                ),
            ]
        )
        session.flush()

    return learner.id, certification.id


def test_postgres_persists_complete_exam(postgres_session):
    learner_id, certification_id = seed_postgres_exam_bank(postgres_session)

    result = ExamService(postgres_session).create_exam(
        learner_id=learner_id,
        certification_id=certification_id,
        question_count=2,
    )

    attempt = postgres_session.get(ExamAttempt, result.attempt_id)
    assert attempt is not None
    assert attempt.question_count == 2
    assert attempt.status == "in_progress"

    assignments = postgres_session.exec(
        select(ExamAttemptQuestion)
        .where(ExamAttemptQuestion.attempt_id == result.attempt_id)
        .order_by(ExamAttemptQuestion.position)
    ).all()
    assert [item.position for item in assignments] == [1, 2]
    assert len({item.question_id for item in assignments}) == 2


def test_postgres_insufficient_pool_persists_nothing(postgres_session):
    learner_id, certification_id = seed_postgres_exam_bank(postgres_session)

    with pytest.raises(InsufficientQuestionsError):
        ExamService(postgres_session).create_exam(
            learner_id=learner_id,
            certification_id=certification_id,
            question_count=4,
        )

    assert postgres_session.exec(select(ExamAttempt)).all() == []
    assert postgres_session.exec(select(ExamAttemptQuestion)).all() == []


def test_postgres_bad_assignment_rolls_back_attempt(postgres_session):
    """A failed child FK must not leave behind the attempt parent row."""
    learner_id, certification_id = seed_postgres_exam_bank(postgres_session)
    existing_question = postgres_session.exec(select(Question)).first()
    assert existing_question is not None

    invalid_selection = ExamQuestionSelection(
        question_id=existing_question.id,
        question_version_id=uuid4(),  # Not a version of that question.
    )
    with pytest.raises(IntegrityError):
        ExamService(postgres_session, FixedSelector([invalid_selection])).create_exam(
            learner_id=learner_id,
            certification_id=certification_id,
            question_count=1,
        )

    assert postgres_session.exec(select(ExamAttempt)).all() == []
    assert postgres_session.exec(select(ExamAttemptQuestion)).all() == []


def test_accepts_category_validated_against_certification():
    """Category-scoped starts forward the selected category to the selector."""
    learner_id, certification_id = uuid4(), uuid4()
    session = RecordingSession(learner_id, certification_id)
    session.category_id = uuid4()
    selector = FixedSelector(selections(3))

    result = ExamService(session, selector).create_exam(
        learner_id=learner_id,
        certification_id=certification_id,
        question_count=3,
        category_id=session.category_id,
    )

    assert selector.calls == [(certification_id, 3, session.category_id)]
    assert result.attempt_id == session.added[0].id
    assert session.commits == 1


def test_rejects_unpublished_category_before_question_selection():
    learner_id, certification_id = uuid4(), uuid4()
    session = RecordingSession(learner_id, certification_id)
    session.category_id = uuid4()
    session.category_published = False
    selector = FixedSelector(selections(1))

    with pytest.raises(CategoryUnavailableError):
        ExamService(session, selector).create_exam(
            learner_id=learner_id,
            certification_id=certification_id,
            question_count=1,
            category_id=session.category_id,
        )

    assert selector.calls == []
    assert session.added == []
    assert session.rollbacks == 1


def test_rejects_category_from_another_certification():
    learner_id, certification_id = uuid4(), uuid4()
    session = RecordingSession(learner_id, certification_id)
    session.category_id = uuid4()  # registered elsewhere / unknown

    with pytest.raises(InvalidCategoryError):
        ExamService(session, FixedSelector(selections(1))).create_exam(
            learner_id=learner_id,
            certification_id=certification_id,
            question_count=1,
            category_id=uuid4(),  # not the session's tracked category
        )
    assert session.added == []
    assert session.rollbacks == 1


def test_rejects_second_attempt_while_one_is_in_progress():
    """AC3: repeated clicks must never create parallel attempts."""
    learner_id, certification_id = uuid4(), uuid4()
    session = RecordingSession(learner_id, certification_id)
    session.active_attempt = SimpleNamespace(id=uuid4())  # live attempt exists

    with pytest.raises(AttemptInProgressError):
        ExamService(session, FixedSelector(selections(2))).create_exam(
            learner_id=learner_id,
            certification_id=certification_id,
            question_count=2,
        )
    assert session.added == []
    assert session.rollbacks == 1


def test_attempt_in_progress_error_carries_existing_id():
    learner_id, certification_id = uuid4(), uuid4()
    session = RecordingSession(learner_id, certification_id)
    existing_id = uuid4()
    session.active_attempt = SimpleNamespace(id=existing_id)

    with pytest.raises(AttemptInProgressError) as exc:
        ExamService(session, FixedSelector(selections(1))).create_exam(
            learner_id=learner_id,
            certification_id=certification_id,
            question_count=1,
        )
    # JHEP-32 recovery: the API surfaces this id so the learner can return
    # to their unfinished exam instead of a duplicate being created.
    assert exc.value.existing_attempt_id == existing_id


def test_allows_start_again_after_previous_attempt_was_submitted():
    learner_id, certification_id = uuid4(), uuid4()
    session = RecordingSession(learner_id, certification_id)
    session.active_attempt = None  # previous attempt submitted -> no guard

    result = ExamService(session, FixedSelector(selections(2))).create_exam(
        learner_id=learner_id,
        certification_id=certification_id,
        question_count=2,
    )
    assert session.commits == 1
    assert session.rollbacks == 0
    attempt = session.added[0]
    assert attempt.id == result.attempt_id
