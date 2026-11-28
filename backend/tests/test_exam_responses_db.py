"""JHEP-32/34/35 PostgreSQL integration: responses, submit, grading flow.

Opt in via RUN_DB_INTEGRATION=1 against a disposable LOCAL PostgreSQL DB.
An isolated schema is created per test and every outer transaction rolls
back, so tests cannot leak rows.
"""

import os
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlmodel import Session, SQLModel, select

from app import models  # noqa: F401
from app.db.session import engine
from app.models import (
    AnswerOption,
    Category,
    Certification,
    ExamAttempt,
    ExamQuestionGrade,
    ExamResponse,
    Question,
    QuestionVersion,
    User,
)
from app.services.exam_attempt_service import (
    AttemptAlreadySubmittedError,
    AttemptQuestionNotFoundError,
    ExamAttemptService,
    InvalidResponseContentError,
    QuestionAlreadyLockedError,
)
from app.services.exam_service import ExamService
from app.services.grading_service import GradingService


@pytest.fixture
def postgres_session():
    if os.getenv("RUN_DB_INTEGRATION") != "1":
        pytest.skip("PostgreSQL integration tests are opt-in")
    if engine.url.get_backend_name() != "postgresql":
        pytest.fail("PostgreSQL integration tests require PostgreSQL")
    if engine.url.host not in ("localhost", "127.0.0.1", None):
        pytest.fail("Refusing to run integration tests on a remote PostgreSQL host")

    schema = f"jhep35_responses_{uuid4().hex[:12]}"
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


class SeededAttempt:
    """Learner + certification + attempt with a selectable question bank."""

    def __init__(self, session):
        self.session = session
        self.learner = User(email=f"grade-{uuid4().hex}@example.com")
        self.cert = Certification(
            name="Grading Demo",
            code=uuid4().hex[:12],
            passing_threshold_pct=50,
            feedback_mode="immediate",
        )
        session.add_all([self.learner, self.cert])
        session.flush()

        self.service = ExamService(session, selector=FixedSelector([]))

    def add_question(self, *, question_type="multiple_choice", correct_positions=()):
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
            question_text=f"Q {uuid4().hex[:6]}",
            question_type=question_type,
            allows_multiple_answers=len(correct_positions) > 1,
            explanation="Why it is so.",
            review_status="approved",
            publication_status="active",
            submitted_by_id=self.learner.id,
            reviewed_by_id=self.learner.id,
            reviewed_at=datetime.now(UTC),
        )
        self.session.add(version)
        self.session.flush()

        option_ids = []
        for position in range(1, 4):
            option = AnswerOption(
                question_version_id=version.id,
                position=position,
                option_text=f"Option {position}",
                is_correct=position in correct_positions,
            )
            self.session.add(option)
            option_ids.append(option.id)
        self.session.flush()
        return question.id, version.id, option_ids

    def create_attempt(self, versions_with_keys):
        """versions_with_keys: list of (question_id, version_id) to pin."""
        self.service._selector = FixedSelector(
            [
                type("S", (), {"question_id": q, "question_version_id": v})
                for q, v in versions_with_keys
            ]
        )
        return self.service.create_exam(
            learner_id=self.learner.id,
            certification_id=self.cert.id,
            question_count=len(versions_with_keys),
        )


class FixedSelector:
    def __init__(self, selections):
        self.selections = selections

    def select_random_eligible(self, certification_id, question_count):
        return list(self.selections)[:question_count]


def test_save_update_clear_cycle_and_uniqueness(postgres_session):
    session = postgres_session
    bank = SeededAttempt(session)
    question_id, version_id, option_ids = bank.add_question(correct_positions=(1,))
    bank.create_attempt([(question_id, version_id)])
    attempt = session.exec(select(ExamAttempt)).first()
    service = ExamAttemptService(session)
    attempt = service.get_owned_attempt(
        attempt_id=attempt.id, learner_id=bank.learner.id
    )

    # Save → replace → clear; exactly one row per version, none at the end.
    saved = service.save_response(
        attempt,
        version_id,
        selected_option_ids=[option_ids[1]],
        text_response=None,
    )
    assert saved is not None and saved.selected_option_ids == [str(option_ids[1])]

    updated = service.save_response(
        attempt,
        version_id,
        selected_option_ids=[option_ids[0]],
        text_response=None,
    )
    assert updated.selected_option_ids == [str(option_ids[0])]

    cleared = service.save_response(
        attempt,
        version_id,
        selected_option_ids=None,
        text_response=None,
    )
    assert cleared is None
    assert session.exec(select(ExamResponse)).all() == []


def test_foreign_option_and_multi_answer_rules_are_rejected(postgres_session):
    session = postgres_session
    bank = SeededAttempt(session)
    pinned_question, pinned_version, option_ids = bank.add_question(
        correct_positions=(1,)
    )
    _, other_version, other_options = bank.add_question(correct_positions=(2,))
    bank.create_attempt([(pinned_question, pinned_version)])
    attempt = session.exec(select(ExamAttempt)).first()
    service = ExamAttemptService(session)
    attempt = service.get_owned_attempt(
        attempt_id=attempt.id, learner_id=bank.learner.id
    )

    with pytest.raises(InvalidResponseContentError):
        service.save_response(
            attempt,
            pinned_version,
            selected_option_ids=[other_options[0]],
            text_response=None,
        )

    with pytest.raises(InvalidResponseContentError):
        service.save_response(
            attempt,
            pinned_version,
            selected_option_ids=[option_ids[0], option_ids[1]],
            text_response=None,
        )


def test_unknown_question_is_not_found_for_the_actual_attempt(postgres_session):
    session = postgres_session
    bank = SeededAttempt(session)
    question_id, real_version, _ = bank.add_question(correct_positions=(1,))
    bank.create_attempt([(question_id, real_version)])
    attempt = session.exec(select(ExamAttempt)).first()
    service = ExamAttemptService(session)
    attempt = service.get_owned_attempt(
        attempt_id=attempt.id, learner_id=bank.learner.id
    )
    with pytest.raises(AttemptQuestionNotFoundError):
        service.save_response(
            attempt,
            uuid4(),  # valid-looking version id, but not pinned in this attempt
            selected_option_ids=[uuid4()],
            text_response=None,
        )


def test_immediate_submit_grades_once_and_final_grading_reuses_rows(
    postgres_session,
):
    session = postgres_session
    bank = SeededAttempt(session)
    first_question, first_version, first_options = bank.add_question(
        correct_positions=(1,)
    )
    second_question, second_version, second_options = bank.add_question(
        correct_positions=(2,)
    )
    bank.create_attempt(
        [(first_question, first_version), (second_question, second_version)]
    )
    attempt = session.exec(select(ExamAttempt)).first()
    service = ExamAttemptService(session)
    attempt = service.get_owned_attempt(
        attempt_id=attempt.id, learner_id=bank.learner.id
    )

    # Immediate mode: the wrong answer for Q1 releases feedback instantly.
    feedback = service.submit_question(
        attempt,
        first_version,
        selected_option_ids=[first_options[1]],  # wrong option of Q1 itself
        text_response=None,
    )
    assert feedback["feedback_released"] is True
    assert feedback["is_correct"] is False
    assert feedback["correct_option_ids"] == [first_options[0]]
    assert feedback["explanation"] == "Why it is so."

    # Correct answer for Q2.
    feedback = service.submit_question(
        attempt,
        second_version,
        selected_option_ids=[second_options[1]],
        text_response=None,
    )
    assert feedback["is_correct"] is True

    # Locked questions are immutable from now on.
    with pytest.raises(QuestionAlreadyLockedError):
        service.save_response(
            attempt,
            first_version,
            selected_option_ids=[first_options[0]],
            text_response=None,
        )

    result = service.final_submit(attempt)

    assert (result.points_earned, result.points_possible) == (1, 2)
    assert result.passed is True  # 50% meets-or-exceeds the 50% threshold
    rows = session.exec(
        select(ExamQuestionGrade).where(ExamQuestionGrade.attempt_id == attempt.id)
    ).all()
    # Exactly one grade row per question: no duplicates from final grading.
    assert {row.question_version_id for row in rows} == {
        first_version,
        second_version,
    }
    outcomes = sorted(row.outcome for row in rows)
    assert outcomes == ["correct", "incorrect"]


def test_deferred_mode_withholds_correctness_until_final_submit(postgres_session):
    session = postgres_session
    bank = SeededAttempt(session)
    bank.cert.feedback_mode = "deferred"
    text_question_id, version_id, option_ids = bank.add_question(correct_positions=(1,))
    bank.create_attempt([(text_question_id, version_id)])
    attempt = session.exec(select(ExamAttempt)).first()
    service = ExamAttemptService(session)
    attempt = service.get_owned_attempt(
        attempt_id=attempt.id, learner_id=bank.learner.id
    )

    feedback = service.submit_question(
        attempt,
        version_id,
        selected_option_ids=[option_ids[0]],
        text_response=None,
    )
    assert feedback["feedback_released"] is False
    assert feedback["is_correct"] is None
    assert feedback["correct_option_ids"] is None

    # Saved response echoes without correctness while in progress.
    blocks = service.response_blocks(attempt)
    assert "is_correct" not in blocks[version_id]

    result = service.final_submit(attempt)
    assert result.points_earned == 1

    blocks = service.response_blocks(attempt)
    assert blocks[version_id]["is_correct"] is True


def test_final_submit_is_the_only_grading_gate(postgres_session):
    session = postgres_session
    bank = SeededAttempt(session)
    question_id, version_id, option_ids = bank.add_question(correct_positions=(1,))
    bank.create_attempt([(question_id, version_id)])
    attempt = session.exec(select(ExamAttempt)).first()
    service = ExamAttemptService(session)

    in_progress = service.get_owned_attempt(
        attempt_id=attempt.id, learner_id=bank.learner.id
    )
    from app.services.grading_service import AttemptNotSubmittedError

    with pytest.raises(AttemptNotSubmittedError):
        # Grading refuses anything not finally submitted (AC4 key safety).
        GradingService(session).grade_attempt(in_progress.id)

    # The learner answers correctly and individually submits the question;
    # the saved selection must be graded by the final run.
    service.save_response(
        attempt,
        version_id,
        selected_option_ids=[option_ids[0]],
        text_response=None,
        submit=True,
    )

    result = service.final_submit(attempt)
    assert result.points_earned == 1

    # After final submission the attempt is immutable: no edits, no
    # duplicate submissions, no navigation updates.
    with pytest.raises(AttemptAlreadySubmittedError):
        service.apply_progress(attempt, 1)
    with pytest.raises(AttemptAlreadySubmittedError):
        service.save_response(
            attempt,
            version_id,
            selected_option_ids=[option_ids[0]],
            text_response=None,
        )
    with pytest.raises(AttemptAlreadySubmittedError):
        service.final_submit(attempt)

    # Response rows reference exactly what was presented and answered.
    response = session.exec(
        select(ExamResponse).where(ExamResponse.attempt_id == attempt.id)
    ).first()
    assert response.is_submitted is True
    assert response.is_correct is True


def test_short_answer_is_excluded_from_grading(postgres_session):
    session = postgres_session
    bank = SeededAttempt(session)
    text_question_id, text_version, _ = bank.add_question(question_type="short_answer")
    bank.create_attempt([(text_question_id, text_version)])
    attempt = session.exec(select(ExamAttempt)).first()
    service = ExamAttemptService(session)
    attempt = service.get_owned_attempt(
        attempt_id=attempt.id, learner_id=bank.learner.id
    )

    service.save_response(
        attempt,
        text_version,
        selected_option_ids=None,
        text_response="Maximizing value",
        submit=True,
    )
    result = service.final_submit(attempt)

    # Zero gradable questions → no misleading percentage, no Pass/Fail.
    assert result.points_possible == 0
    assert result.passed is None


def test_duplicate_start_protection_survives_persistence(postgres_session):
    """AC3: the in-progress guard must be state-aware — once an attempt is
    committed, a second start for the same learner + certification is
    refused until that attempt is submitted (Try Again)."""
    from app.models import ExamAttempt
    from app.services.exam_service import AttemptInProgressError, ExamService

    learner = User(email=f"dup-start-{uuid4().hex}@example.test")
    certification = Certification(
        name="Duplicate Start",
        code=uuid4().hex[:12],
        passing_threshold_pct=50,
    )
    category = Category(
        certification_id=certification.id,
        name="Dup Start Category",
        is_published=True,
    )
    # Two-phase flush (repo convention): parents commit-visibility before
    # children; a single combined add_all here sorts categories ahead of
    # their parent certification and trips the FK.
    postgres_session.add_all([learner, certification])
    postgres_session.flush()
    postgres_session.add(category)
    postgres_session.flush()

    question = Question(
        certification_id=certification.id,
        category_id=category.id,
        difficulty="easy",
        created_by_id=learner.id,
    )
    postgres_session.add(question)
    postgres_session.flush()

    version = QuestionVersion(
        question_id=question.id,
        version_number=1,
        question_text="Single question",
        question_type="multiple_choice",
        allows_multiple_answers=False,
        review_status="approved",
        publication_status="active",
        submitted_by_id=learner.id,
        reviewed_by_id=learner.id,
        reviewed_at=datetime.now(UTC),
    )
    postgres_session.add(version)
    postgres_session.flush()
    # Eligibility requires >= 2 options and exactly-one correct for a
    # single-answer question (JHEP-27's shared eligibility statement).
    postgres_session.add_all(
        [
            AnswerOption(
                question_version_id=version.id,
                position=1,
                option_text="First",
                is_correct=True,
            ),
            AnswerOption(
                question_version_id=version.id,
                position=2,
                option_text="Second",
                is_correct=False,
            ),
        ]
    )
    postgres_session.commit()

    service = ExamService(postgres_session)

    # First start succeeds and stays in progress.
    first = service.create_exam(
        learner_id=learner.id,
        certification_id=certification.id,
        category_id=category.id,
        question_count=1,
    )
    attempts = postgres_session.exec(select(ExamAttempt)).all()
    assert len(attempts) == 1

    # Second start is refused, naming the existing attempt; nothing new.
    with pytest.raises(AttemptInProgressError) as exc:
        service.create_exam(
            learner_id=learner.id,
            certification_id=certification.id,
            category_id=category.id,
            question_count=1,
        )
    assert exc.value.existing_attempt_id == first.attempt_id
    assert len(postgres_session.exec(select(ExamAttempt)).all()) == 1

    # Submitting unlocks Try Again: a fresh attempt is created and kept.
    attempt = postgres_session.get(ExamAttempt, first.attempt_id)
    attempt.status = "submitted"
    attempt.submitted_at = datetime.now(UTC)
    postgres_session.add(attempt)
    postgres_session.commit()

    second = ExamService(postgres_session).create_exam(
        learner_id=learner.id,
        certification_id=certification.id,
        category_id=category.id,
        question_count=1,
    )
    assert second.attempt_id != first.attempt_id
    assert len(postgres_session.exec(select(ExamAttempt)).all()) == 2


@pytest.mark.parametrize("feedback_mode", ["immediate", "deferred"])
def test_question_flags_are_independent_of_answers(postgres_session, feedback_mode):
    session = postgres_session
    bank = SeededAttempt(session)
    bank.cert.feedback_mode = feedback_mode
    first_question, first_version, first_options = bank.add_question(
        correct_positions=(1,)
    )
    second_question, second_version, second_options = bank.add_question(
        correct_positions=(1,)
    )
    assignments = [(first_question, first_version), (second_question, second_version)]
    created = bank.create_attempt(assignments)
    service = ExamAttemptService(session)
    attempt = service.get_owned_attempt(
        attempt_id=created.attempt_id, learner_id=bank.learner.id
    )
    pinned = service.resolve_question(attempt.id, first_version)
    pinned_id = pinned.id
    assert pinned.flagged_for_review is False

    # Unanswered question: repeated explicit writes create no response rows.
    for _ in range(2):
        flagged = service.set_question_flag(attempt, pinned_id, flagged_for_review=True)
        assert flagged.id == pinned_id
        assert flagged.flagged_for_review is True
    assert service.response_blocks(attempt) == {}
    assert service.answer_counts(attempt) == (0, 2)
    flags = {
        q.id: q.flagged_for_review for q in bank.service.get_exam_questions(attempt.id)
    }
    assert flags == {first_version: True, second_version: False}

    # An unsubmitted draft survives flagging and unflagging unchanged.
    service.save_response(
        attempt,
        first_version,
        selected_option_ids=[first_options[0]],
        text_response=None,
    )
    draft = service.response_blocks(attempt)[first_version]
    service.set_question_flag(attempt, first_version, flagged_for_review=False)
    assert service.response_blocks(attempt)[first_version] == draft
    assert draft["is_submitted"] is False
    service.set_question_flag(attempt, first_version, flagged_for_review=True)

    # Submitted answers remain locked; flags are not grading operations.
    feedback = service.submit_question(
        attempt,
        first_version,
        selected_option_ids=[first_options[0]],
        text_response=None,
    )
    assert feedback["feedback_released"] is (feedback_mode == "immediate")
    saved = service.response_blocks(attempt)[first_version]
    service.set_question_flag(attempt, first_version, flagged_for_review=False)
    service.set_question_flag(attempt, first_version, flagged_for_review=True)
    assert service.response_blocks(attempt)[first_version] == saved
    assert saved["is_submitted"] is True
    assert "is_correct" not in saved
    with pytest.raises(QuestionAlreadyLockedError):
        service.save_response(
            attempt,
            first_version,
            selected_option_ids=[first_options[1]],
            text_response=None,
        )

    with pytest.raises(AttemptQuestionNotFoundError):
        service.set_question_flag(attempt, uuid4(), flagged_for_review=True)

    # Navigation does not change flags or mutate response state.
    service.apply_progress(attempt, 2)
    assert service.resolve_question(attempt.id, pinned_id).flagged_for_review is True
    assert service.response_blocks(attempt)[first_version] == saved
    service.submit_question(
        attempt,
        second_version,
        selected_option_ids=[second_options[0]],
        text_response=None,
    )
    result = service.final_submit(attempt)
    assert result.points_earned == 2
    with pytest.raises(AttemptAlreadySubmittedError):
        service.set_question_flag(attempt, first_version, flagged_for_review=False)

    # A subsequent attempt using the very same questions starts unflagged.
    subsequent = bank.create_attempt(assignments)
    next_attempt = service.get_owned_attempt(
        attempt_id=subsequent.attempt_id, learner_id=bank.learner.id
    )
    assert (
        service.resolve_question(next_attempt.id, first_version).flagged_for_review
        is False
    )
    with pytest.raises(AttemptQuestionNotFoundError):
        service.set_question_flag(next_attempt, pinned_id, flagged_for_review=True)
    assert service.resolve_question(attempt.id, pinned_id).flagged_for_review is True
    assert session.get(QuestionVersion, first_version).is_flagged is False


@pytest.mark.parametrize("feedback_mode", ["immediate", "deferred"])
def test_completed_review_preserves_pins_and_outcomes(postgres_session, feedback_mode):
    from app.services.exam_review_service import completed_review_payload
    from app.services.grading_service import AttemptNotSubmittedError

    session = postgres_session
    bank = SeededAttempt(session)
    bank.cert.feedback_mode = feedback_mode
    correct = bank.add_question(correct_positions=(1,))
    incorrect = bank.add_question(correct_positions=(1, 3))
    draft = bank.add_question(correct_positions=(2,))
    pending = bank.add_question(question_type="short_answer")
    skipped = bank.add_question(question_type="short_answer")
    missing_grade = bank.add_question(correct_positions=(1,))
    questions = [correct, incorrect, draft, pending, skipped, missing_grade]
    original = session.get(QuestionVersion, correct[1])
    original.question_text = "Original pinned question. " + "Historical text " * 30
    session.add(original)
    session.flush()

    created = bank.create_attempt([(q, v) for q, v, _ in questions])
    service = ExamAttemptService(session)
    attempt = service.get_owned_attempt(
        attempt_id=created.attempt_id, learner_id=bank.learner.id
    )
    with pytest.raises(AttemptNotSubmittedError):
        completed_review_payload(session, attempt)

    for question in (correct, incorrect, draft, missing_grade):
        service.save_response(
            attempt,
            question[1],
            selected_option_ids=[question[2][0]],
            text_response=None,
            submit=question != draft,
        )
    service.save_response(
        attempt,
        pending[1],
        selected_option_ids=None,
        text_response="A submitted written answer",
        submit=True,
    )
    service.final_submit(attempt)

    # Retire the pinned version and publish a different version of the same
    # question. Historical review must not re-resolve the current question.
    original = session.get(QuestionVersion, correct[1])
    original.publication_status = "retired"
    session.add(original)
    session.flush()
    session.add(
        QuestionVersion(
            question_id=correct[0],
            version_number=2,
            question_text="Replacement question, not part of this attempt.",
            question_type="multiple_choice",
            allows_multiple_answers=False,
            explanation="New explanation",
            review_status="approved",
            publication_status="active",
            submitted_by_id=bank.learner.id,
            reviewed_by_id=bank.learner.id,
            reviewed_at=datetime.now(UTC),
        )
    )
    # Simulate a legacy/incomplete grade record. The pinned question stays.
    grade = session.exec(
        select(ExamQuestionGrade).where(
            ExamQuestionGrade.attempt_id == attempt.id,
            ExamQuestionGrade.question_version_id == missing_grade[1],
        )
    ).one()
    session.delete(grade)
    session.commit()

    review = completed_review_payload(session, attempt)
    assert review.question_count == 6
    assert [q.position for q in review.questions] == list(range(1, 7))
    assert [q.question_version_id for q in review.questions] == [
        question[1] for question in questions
    ]
    assert [q.status for q in review.questions] == [
        "correct",
        "incorrect",
        "unanswered",
        "pending_manual_grading",
        "unanswered",
        "unavailable",
    ]
    preview = review.questions[0].preview
    assert preview.startswith("Original pinned question.")
    assert len(preview) <= 160 and preview.endswith("…")
    assert "Replacement question" not in review.model_dump_json()
    assert "A submitted written answer" not in review.model_dump_json()
    assert "Why it is so." not in review.model_dump_json()
    assert completed_review_payload(session, attempt) == review
