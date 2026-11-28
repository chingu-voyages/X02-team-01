"""JHEP-120: real PostgreSQL selection, storage, retries and grading lifecycle.

A private schema is committed per test so competing requests can use
independent sessions. Only disposable local PostgreSQL is supported.
"""

import os
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlmodel import Session, SQLModel, select

from app.db.session import engine
from app.models import (
    Certification,
    ExamAttempt,
    ExamQuestionGrade,
    ExamResponse,
    Question,
    QuestionVersion,
    TextAnswerKey,
    User,
)
from app.schemas.exam import MAX_TEXT_ANSWER_LENGTH, ExamQuestionOut
from app.services.exam_attempt_service import (
    AttemptAlreadySubmittedError,
    AttemptQuestionNotFoundError,
    ExamAttemptService,
    InvalidResponseContentError,
    NoAnswerContentError,
    QuestionAlreadyLockedError,
)
from app.services.exam_service import ExamAttemptNotFoundError, ExamService


@pytest.fixture
def essay_engine():
    if os.getenv("RUN_DB_INTEGRATION") != "1":
        pytest.skip("PostgreSQL integration tests are opt-in")
    if engine.url.get_backend_name() != "postgresql" or engine.url.host not in (
        "localhost",
        "127.0.0.1",
        None,
    ):
        pytest.fail("Use disposable local PostgreSQL only")
    schema = f"jhep120_essay_{uuid4().hex[:12]}"
    with engine.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    scoped = engine.execution_options(schema_translate_map={None: schema})
    try:
        SQLModel.metadata.create_all(scoped)
        yield scoped
    finally:
        with engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))


def seed_attempt(scoped, feedback_mode="immediate", question_type="essay"):
    with Session(scoped) as session:
        learner = User(email=f"essay-{uuid4().hex}@example.test")
        cert = Certification(
            name="Essay certification",
            code=uuid4().hex,
            passing_threshold_pct=70,
            feedback_mode=feedback_mode,
            is_published=True,
        )
        session.add_all([learner, cert])
        session.flush()
        question = Question(
            certification_id=cert.id,
            difficulty="medium",
            created_by_id=learner.id,
        )
        session.add(question)
        session.flush()
        version = QuestionVersion(
            question_id=question.id,
            version_number=1,
            question_text="Explain caching and invalidation.",
            question_type=question_type,
            allows_multiple_answers=False,
            explanation="Private explanation",
            review_status="approved",
            publication_status="active",
            submitted_by_id=learner.id,
            reviewed_by_id=learner.id,
            reviewed_at=datetime.now(UTC),
        )
        session.add(version)
        session.flush()
        session.add(
            TextAnswerKey(
                question_version_id=version.id,
                expected_answer="Private model answer",
                max_points=2,
            )
        )
        learner_id, cert_id, question_id, version_id = (
            learner.id,
            cert.id,
            question.id,
            version.id,
        )
        session.commit()
        created = ExamService(session).create_exam(
            learner_id=learner_id, certification_id=cert_id, question_count=1
        )
        return created.attempt_id, question_id, version_id, learner_id


def submit(service, attempt, version, value):
    return service.submit_question(
        attempt, version, selected_option_ids=None, text_response=value
    )


def saved_rows(session, attempt_id):
    return session.exec(
        select(ExamResponse).where(ExamResponse.attempt_id == attempt_id)
    ).all()


@pytest.mark.parametrize("mode", ["immediate", "deferred"])
def test_essay_selection_draft_submission_retry_and_results(essay_engine, mode):
    attempt_id, question_id, version_id, learner_id = seed_attempt(essay_engine, mode)
    value = "  First paragraph 😀.\n\n  Second paragraph.\n"
    with Session(essay_engine) as session:
        exam = ExamService(session)
        attempt = exam.get_owned_attempt(attempt_id=attempt_id, learner_id=learner_id)
        questions = exam.get_exam_questions(attempt_id)
        assert len(questions) == 1
        question = ExamQuestionOut.model_validate(questions[0])
        assert question.question_type == "essay"
        assert question.options == []
        assert "Private model answer" not in question.model_dump_json()
        service = ExamAttemptService(session)
        draft = service.save_response(
            attempt, version_id, selected_option_ids=None, text_response=value
        )
        assert draft.text_response == value
        assert draft.is_submitted is False
        service.apply_progress(attempt, 1)
        assert service.response_blocks(attempt)[version_id]["text_response"] == value
        feedback = submit(service, attempt, version_id, value)
        assert feedback["question_submitted_at"] is not None
        assert feedback["feedback_released"] is False
        assert feedback["is_correct"] is None
        assert feedback["correct_option_ids"] is None
        assert feedback["explanation"] is None
        assert submit(service, attempt, version_id, value) == feedback
        rows = saved_rows(session, attempt_id)
        assert len(rows) == 1
        assert rows[0].question_id == question_id
        assert rows[0].question_version_id == version_id
        assert rows[0].text_response == value
        assert rows[0].is_submitted is True
        with pytest.raises(QuestionAlreadyLockedError):
            submit(service, attempt, version_id, "Overwrite")
        with pytest.raises(QuestionAlreadyLockedError):
            service.save_response(
                attempt, version_id, selected_option_ids=None, text_response="Overwrite"
            )
        service.final_submit(attempt)
        result = service.results_payload(attempt)
        assert result["pending_manual_grading_count"] == 1
        assert result["grading_complete"] is False
        assert result["passed"] is None
        assert result["score_percent"] is None
        assert result["points_possible"] == 0
        assert result["questions"][0]["status"] == "pending_manual_grading"
        assert result["questions"][0]["learner_response"] == value
        grades = session.exec(
            select(ExamQuestionGrade).where(ExamQuestionGrade.attempt_id == attempt_id)
        ).all()
        assert len(grades) == 1 and grades[0].outcome == "ungraded"
        with pytest.raises(AttemptAlreadySubmittedError):
            submit(service, attempt, version_id, value)


@pytest.mark.parametrize(
    "value",
    ["", " \n\t", "😀" * (MAX_TEXT_ANSWER_LENGTH + 1), "bad\x00text"],
)
def test_rejects_invalid_essay_without_overwriting_draft(essay_engine, value):
    attempt_id, _, version_id, _ = seed_attempt(essay_engine)
    with Session(essay_engine) as session:
        attempt = session.get(ExamAttempt, attempt_id)
        service = ExamAttemptService(session)
        service.save_response(
            attempt,
            version_id,
            selected_option_ids=None,
            text_response="Original draft",
        )
        with pytest.raises((InvalidResponseContentError, NoAnswerContentError)):
            submit(service, attempt, version_id, value)
        row = saved_rows(session, attempt_id)[0]
        assert row.text_response == "Original draft"
        assert row.is_submitted is False


def test_essay_max_length_and_attempt_isolation(essay_engine):
    attempt_id, _, version_id, learner_id = seed_attempt(essay_engine)
    other_id, _, other_version, other_learner = seed_attempt(essay_engine)
    with Session(essay_engine) as session:
        exam = ExamService(session)
        with pytest.raises(ExamAttemptNotFoundError):
            exam.get_owned_attempt(attempt_id=attempt_id, learner_id=other_learner)
        attempt = exam.get_owned_attempt(attempt_id=attempt_id, learner_id=learner_id)
        service = ExamAttemptService(session)
        with pytest.raises(AttemptQuestionNotFoundError):
            submit(service, attempt, other_version, "Not my question")
        with pytest.raises(InvalidResponseContentError):
            service.submit_question(
                attempt, version_id, selected_option_ids=[uuid4()], text_response=None
            )
        maximum = "😀" * MAX_TEXT_ANSWER_LENGTH
        submit(service, attempt, version_id, maximum)
        assert saved_rows(session, attempt_id)[0].text_response == maximum
        assert saved_rows(session, other_id) == []


def test_short_answer_still_trims_and_releases_immediate_explanation(essay_engine):
    attempt_id, _, version_id, _ = seed_attempt(
        essay_engine, question_type="short_answer"
    )
    with Session(essay_engine) as session:
        attempt = session.get(ExamAttempt, attempt_id)
        service = ExamAttemptService(session)
        feedback = submit(service, attempt, version_id, "  Short answer  ")
        assert feedback["feedback_released"] is True
        assert feedback["explanation"] == "Private explanation"
        assert saved_rows(session, attempt_id)[0].text_response == "Short answer"
        with pytest.raises(QuestionAlreadyLockedError):
            submit(service, attempt, version_id, "  Short answer  ")


@pytest.mark.parametrize("same_text", [True, False])
def test_concurrent_essay_submissions_never_create_duplicate_or_overwrite(
    essay_engine, same_text
):
    attempt_id, _, version_id, _ = seed_attempt(essay_engine)
    barrier = Barrier(2, timeout=10)
    answers = ["First essay", "First essay" if same_text else "Second essay"]

    def worker(value):
        with Session(essay_engine) as session:
            attempt = session.get(ExamAttempt, attempt_id)
            service = ExamAttemptService(session)
            # Both independent sessions have read the original attempt.
            barrier.wait()
            try:
                submit(service, attempt, version_id, value)
                return "saved", value
            except QuestionAlreadyLockedError:
                return "locked", value

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(worker, answer) for answer in answers]
        outcomes = [future.result(timeout=20) for future in futures]
    statuses = sorted(status for status, _ in outcomes)
    assert statuses == (["saved", "saved"] if same_text else ["locked", "saved"])
    with Session(essay_engine) as session:
        rows = saved_rows(session, attempt_id)
        assert len(rows) == 1
        assert rows[0].text_response == next(
            v for status, v in outcomes if status == "saved"
        )
        assert rows[0].is_submitted is True


def test_final_submission_serializes_against_a_concurrent_essay_write(essay_engine):
    attempt_id, _, version_id, _ = seed_attempt(essay_engine)
    barrier = Barrier(2, timeout=10)

    def submit_essay():
        with Session(essay_engine) as session:
            attempt = session.get(ExamAttempt, attempt_id)
            barrier.wait()
            try:
                submit(ExamAttemptService(session), attempt, version_id, "Race answer")
                return "saved"
            except AttemptAlreadySubmittedError:
                return "closed"

    def finish_exam():
        with Session(essay_engine) as session:
            attempt = session.get(ExamAttempt, attempt_id)
            barrier.wait()
            ExamAttemptService(session).final_submit(attempt)

    with ThreadPoolExecutor(max_workers=2) as pool:
        essay_future = pool.submit(submit_essay)
        finish_future = pool.submit(finish_exam)
        outcome = essay_future.result(timeout=20)
        finish_future.result(timeout=20)

    with Session(essay_engine) as session:
        attempt = session.get(ExamAttempt, attempt_id)
        service = ExamAttemptService(session)
        assert attempt.status == "submitted"
        rows = saved_rows(session, attempt_id)
        result = service.results_payload(attempt)
        if outcome == "saved":
            assert len(rows) == 1 and rows[0].text_response == "Race answer"
            assert result["pending_manual_grading_count"] == 1
        else:
            assert rows == []
            assert result["pending_manual_grading_count"] == 0
        with pytest.raises(AttemptAlreadySubmittedError):
            submit(service, attempt, version_id, "Late write")
