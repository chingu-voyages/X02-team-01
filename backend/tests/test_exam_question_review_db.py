"""JHEP-72 real PostgreSQL/service/HTTP integration tests.

Opt in with RUN_DB_INTEGRATION=1 against disposable LOCAL PostgreSQL only.
Every test has its own schema inside an outer transaction that rolls back.
"""

import os
from contextlib import contextmanager
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlmodel import Session, SQLModel, select

from app import models  # noqa: F401
from app.api.deps import get_authenticated_subject
from app.api.v1.endpoints.exam_question_review import router
from app.db.session import engine, get_session
from app.models import (
    AnswerOption,
    Certification,
    ExamAttempt,
    ExamAttemptQuestion,
    ExamQuestionGrade,
    ExamResponse,
    ExamResult,
    Question,
    QuestionImage,
    QuestionVersion,
    User,
)
from app.services.exam_attempt_service import ExamAttemptService
from app.services.exam_question_review_service import ExamQuestionReviewService
from app.services.exam_service import ExamService


@pytest.fixture
def postgres_session():
    if os.getenv("RUN_DB_INTEGRATION") != "1":
        pytest.skip("PostgreSQL integration tests are opt-in")
    if engine.url.get_backend_name() != "postgresql":
        pytest.fail("PostgreSQL integration tests require PostgreSQL")
    if engine.url.host not in ("localhost", "127.0.0.1", None):
        pytest.fail("Refusing integration tests on a remote PostgreSQL host")

    schema = f"jhep72_review_{uuid4().hex[:12]}"
    with engine.connect() as connection:
        outer = connection.begin()
        try:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
            scoped = connection.execution_options(schema_translate_map={None: schema})
            SQLModel.metadata.create_all(scoped)
            with Session(
                bind=scoped, join_transaction_mode="create_savepoint"
            ) as session:
                yield session
        finally:
            outer.rollback()


class _FixedSelector:
    def __init__(self, pins):
        self.pins = pins

    def select_random_eligible(self, certification_id, question_count):
        return [
            SimpleNamespace(question_id=q, question_version_id=v)
            for q, v in self.pins[:question_count]
        ]


class _Bank:
    def __init__(self, session, mode="immediate"):
        self.session = session
        self.learner = User(email=f"review72-{uuid4().hex}@example.com")
        self.cert = Certification(
            name="Question review test",
            code=uuid4().hex[:12],
            passing_threshold_pct=50,
            feedback_mode=mode,
        )
        session.add_all([self.learner, self.cert])
        session.flush()

    def question(self, *, question_type="multiple_choice", correct_positions=(1,)):
        question = Question(
            certification_id=self.cert.id,
            difficulty="easy",
            created_by_id=self.learner.id,
        )
        self.session.add(question)
        self.session.flush()
        version = QuestionVersion(
            question_id=question.id,
            version_number=1,
            question_text="Original: $x^2$ — 日本語 / مرحبا",
            question_type=question_type,
            allows_multiple_answers=(
                question_type == "multiple_choice" and len(correct_positions) > 1
            ),
            explanation="Original explanation $x^2$.\n日本語 / مرحبا",
            review_status="approved",
            publication_status="active",
            submitted_by_id=self.learner.id,
            reviewed_by_id=self.learner.id,
            reviewed_at=datetime.now(UTC),
        )
        self.session.add(version)
        self.session.flush()
        options = []
        if question_type == "multiple_choice":
            for position in range(1, 4):
                option = AnswerOption(
                    question_version_id=version.id,
                    position=position,
                    option_text=f"Original option {position}",
                    is_correct=position in correct_positions,
                )
                self.session.add(option)
                options.append(option.id)
        self.session.flush()
        return question, version, options

    def attempt(self, pins):
        created = ExamService(self.session, selector=_FixedSelector(pins)).create_exam(
            learner_id=self.learner.id,
            certification_id=self.cert.id,
            question_count=len(pins),
        )
        return self.session.get(ExamAttempt, created.attempt_id)

    def detail(self, attempt, version):
        return ExamQuestionReviewService(self.session).read(
            attempt_id=attempt.id,
            question_version_id=version.id,
            learner_id=self.learner.id,
        )


@contextmanager
def _client(session, learner_id):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1/exams")
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[get_authenticated_subject] = lambda: str(learner_id)
    with TestClient(app) as client:
        yield client


def _url(attempt_id, version_id):
    return f"/api/v1/exams/{attempt_id}/review/questions/{version_id}"


def _snapshot(session):
    result = {}
    for model in (
        ExamAttempt,
        ExamAttemptQuestion,
        ExamResponse,
        ExamQuestionGrade,
        ExamResult,
    ):
        rows = session.exec(select(model)).all()
        result[model.__name__] = sorted(
            [row.model_dump(mode="json") for row in rows], key=lambda row: row["id"]
        )
    return result


@pytest.mark.parametrize("mode", ["immediate", "deferred"])
@pytest.mark.parametrize(
    ("selected_indexes", "expected"),
    [
        ((0, 2), "correct"),
        ((0,), "incorrect"),
        ((0, 1, 2), "incorrect"),
        ((1,), "incorrect"),
    ],
)
def test_multiselect_uses_saved_exact_match_in_both_modes(
    postgres_session, mode, selected_indexes, expected
):
    session = postgres_session
    bank = _Bank(session, mode)
    question, version, options = bank.question(correct_positions=(1, 3))
    attempt = bank.attempt([(question.id, version.id)])
    selected = [options[index] for index in selected_indexes]
    service = ExamAttemptService(session)
    service.submit_question(
        attempt, version.id, selected_option_ids=selected, text_response=None
    )
    # Even an individually submitted immediate-feedback question cannot use
    # this completed-review route until final submission.
    with _client(session, bank.learner.id) as client:
        locked = client.get(_url(attempt.id, version.id))
        assert locked.status_code == 409
        assert "correct_option_ids" not in locked.text
        assert "Original explanation" not in locked.text
        service.final_submit(attempt)
        reviewed = client.get(_url(attempt.id, version.id))
    assert reviewed.status_code == 200
    detail = reviewed.json()
    assert detail["question_status"] == expected
    assert detail["correct_option_ids"] == [str(options[0]), str(options[2])]
    assert set(detail["submitted_response"]["selected_option_ids"]) == {
        str(x) for x in selected
    }
    assert reviewed.headers["cache-control"] == "no-store"


def test_new_bank_version_and_retirement_do_not_replace_history(postgres_session):
    session = postgres_session
    bank = _Bank(session)
    question, old, options = bank.question()
    old_image = QuestionImage(
        question_version_id=old.id,
        storage_key="history/original.png",
        alt_text="Original diagram 日本語",
        media_type="image/png",
        position=1,
    )
    session.add(old_image)
    attempt = bank.attempt([(question.id, old.id)])
    service = ExamAttemptService(session)
    service.submit_question(
        attempt, old.id, selected_option_ids=[options[1]], text_response=None
    )
    service.final_submit(attempt)
    before = bank.detail(attempt, old)

    old.publication_status = "retired"
    session.add(old)
    session.flush()
    replacement = QuestionVersion(
        question_id=question.id,
        version_number=2,
        question_text="REPLACEMENT question must not be shown",
        question_type="multiple_choice",
        allows_multiple_answers=False,
        explanation="REPLACEMENT explanation must not be shown",
        review_status="approved",
        publication_status="active",
        submitted_by_id=bank.learner.id,
        reviewed_by_id=bank.learner.id,
        reviewed_at=datetime.now(UTC),
    )
    session.add(replacement)
    session.flush()
    session.add_all(
        [
            AnswerOption(
                question_version_id=replacement.id,
                option_text="REPLACEMENT correct",
                position=1,
                is_correct=True,
            ),
            QuestionImage(
                question_version_id=replacement.id,
                storage_key="history/new.png",
                alt_text="REPLACEMENT diagram",
                media_type="image/png",
                position=1,
            ),
        ]
    )
    session.commit()
    session.expire_all()
    after = bank.detail(attempt, old)
    assert after.model_dump() == before.model_dump()
    assert after.question_status == "incorrect"
    assert after.submitted_response.selected_option_ids == [options[1]]
    assert after.correct_option_ids == [options[0]]
    assert [image.id for image in after.images] == [old_image.id]
    assert "REPLACEMENT" not in after.model_dump_json()
    with _client(session, bank.learner.id) as client:
        assert client.get(_url(attempt.id, replacement.id)).status_code == 404


def test_unknown_foreign_and_unassigned_questions_are_indistinguishable(
    postgres_session,
):
    session = postgres_session
    bank = _Bank(session)
    question, version, _ = bank.question()
    other_q, other_version, _ = bank.question()
    attempt = bank.attempt([(question.id, version.id)])
    ExamAttemptService(session).final_submit(attempt)
    stranger = User(email=f"stranger-{uuid4().hex}@example.com")
    session.add(stranger)
    session.commit()
    with _client(session, stranger.id) as client:
        foreign = client.get(_url(attempt.id, version.id))
        unknown = client.get(_url(uuid4(), version.id))
    with _client(session, bank.learner.id) as client:
        unassigned = client.get(_url(attempt.id, other_version.id))
    for response in (foreign, unknown, unassigned):
        assert response.status_code == 404
        assert response.json() == {"detail": "Exam attempt not found"}
        assert "Original" not in response.text
    # A parent-question identifier is not a pinned-version identifier.
    with _client(session, bank.learner.id) as client:
        assert client.get(_url(attempt.id, other_q.id)).status_code == 404


def test_same_version_in_two_attempts_keeps_responses_and_grades_separate(
    postgres_session,
):
    session = postgres_session
    bank = _Bank(session)
    question, version, options = bank.question()
    service = ExamAttemptService(session)
    first = bank.attempt([(question.id, version.id)])
    service.submit_question(
        first, version.id, selected_option_ids=[options[0]], text_response=None
    )
    service.final_submit(first)
    second = bank.attempt([(question.id, version.id)])
    service.submit_question(
        second, version.id, selected_option_ids=[options[1]], text_response=None
    )
    service.final_submit(second)
    first_detail = bank.detail(first, version)
    second_detail = bank.detail(second, version)
    assert first_detail.question_status == "correct"
    assert second_detail.question_status == "incorrect"
    assert first_detail.submitted_response.selected_option_ids == [options[0]]
    assert second_detail.submitted_response.selected_option_ids == [options[1]]


def test_unanswered_question_keeps_its_original_position(postgres_session):
    session = postgres_session
    bank = _Bank(session)
    first_q, first_v, _ = bank.question()
    second_q, second_v, options = bank.question()
    attempt = bank.attempt([(first_q.id, first_v.id), (second_q.id, second_v.id)])
    ExamAttemptService(session).final_submit(attempt)
    detail = bank.detail(attempt, second_v)
    pinned = session.exec(
        select(ExamAttemptQuestion).where(
            ExamAttemptQuestion.attempt_id == attempt.id,
            ExamAttemptQuestion.question_version_id == second_v.id,
        )
    ).one()
    assert detail.position == pinned.position
    assert detail.question_count == 2
    assert detail.question_status == "unanswered"
    assert detail.submitted_response is None
    assert detail.correct_option_ids == [options[0]]


def test_written_answer_pending_grading_and_later_manual_feedback(postgres_session):
    session = postgres_session
    bank = _Bank(session)
    question, version, _ = bank.question(question_type="short_answer")
    attempt = bank.attempt([(question.id, version.id)])
    service = ExamAttemptService(session)
    service.submit_question(
        attempt,
        version.id,
        selected_option_ids=None,
        text_response="My saved explanation 日本語 / مرحبا",
    )
    service.final_submit(attempt)
    pending = bank.detail(attempt, version)
    assert pending.question_status == "pending_manual_grading"
    assert pending.correct_option_ids is None
    assert pending.options == []
    assert (
        pending.submitted_response.text_response
        == "My saved explanation 日本語 / مرحبا"
    )

    # Fixture-only update of a persisted grading row. This does not simulate
    # or test the separate manual-grading endpoint or its audit workflow.
    grade = session.exec(
        select(ExamQuestionGrade).where(
            ExamQuestionGrade.attempt_id == attempt.id,
            ExamQuestionGrade.question_version_id == version.id,
        )
    ).one()
    grade.outcome = "manually_graded"
    grade.points_earned = 2
    grade.max_points = 4
    grade.graded_by_id = bank.learner.id
    grade.feedback = "Describe the trade-off."
    session.add(grade)
    session.commit()
    graded = bank.detail(attempt, version)
    assert graded.question_status == "manually_graded"
    assert graded.grading.points_earned == 2
    assert graded.grading.max_points == 4
    assert graded.grading.feedback == "Describe the trade-off."
    assert "graded_by_id" not in graded.model_dump_json()


def test_repeated_http_gets_do_not_change_any_attempt_state(postgres_session):
    session = postgres_session
    bank = _Bank(session)
    question, version, options = bank.question()
    attempt = bank.attempt([(question.id, version.id)])
    service = ExamAttemptService(session)
    service.submit_question(
        attempt, version.id, selected_option_ids=[options[0]], text_response=None
    )
    service.final_submit(attempt)
    before = _snapshot(session)
    with _client(session, bank.learner.id) as client:
        first = client.get(_url(attempt.id, version.id))
        second = client.get(_url(attempt.id, version.id))
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    session.expire_all()
    assert _snapshot(session) == before


def test_missing_grade_is_not_recreated_by_review(postgres_session):
    session = postgres_session
    bank = _Bank(session)
    question, version, options = bank.question()
    attempt = bank.attempt([(question.id, version.id)])
    service = ExamAttemptService(session)
    service.submit_question(
        attempt, version.id, selected_option_ids=[options[0]], text_response=None
    )
    service.final_submit(attempt)
    grade = session.exec(
        select(ExamQuestionGrade).where(
            ExamQuestionGrade.attempt_id == attempt.id,
            ExamQuestionGrade.question_version_id == version.id,
        )
    ).one()
    session.delete(grade)
    session.commit()
    detail = bank.detail(attempt, version)
    assert detail.question_status == "unavailable"
    assert detail.grading is None
    assert detail.submitted_response.selected_option_ids == [options[0]]
    assert session.exec(select(ExamQuestionGrade)).all() == []
