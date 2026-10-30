"""JHEP-35 service tests: submission gate, idempotency, single commit.

A deterministic fake session matches the three reads `grade_attempt`
performs (existing result, pinned versions, answer keys) in order, so the
orchestration logic is verified without PostgreSQL. The AC1/AC2 scoring
matrix itself lives in `test_grading_service.py`; real-Postgres coverage
(query counts, constraint enforcement) is added with JHEP-32/34
integration and the opt-in DB suite.
"""

from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.models import ExamAttempt, ExamResult
from app.services.grading_service import (
    AttemptNotSubmittedError,
    GradingService,
    MissingThresholdError,
    ResponseSourceUnavailableError,
)


class ExecResult:
    def __init__(self, values):
        self._values = values

    def first(self):
        return self._values[0] if self._values else None

    def all(self):
        return self._values


class FakeGradingSession:
    def __init__(self, attempt, exec_queue):
        self.attempt = attempt
        self._exec_queue = list(exec_queue)
        self.add_all_rows = []
        self.add_rows = []
        self.commits = 0
        self.rollbacks = 0

    def get(self, model, identifier):
        if model is ExamAttempt and identifier == self.attempt.id:
            return self.attempt
        return None

    def exec(self, statement):
        return ExecResult(self._exec_queue.pop(0))

    def add_all(self, rows):
        self.add_all_rows.extend(rows)

    def add(self, row):
        self.add_rows.append(row)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


class StubResponses:
    """Minimal stand-in for JHEP-32's saved-answers source."""

    def __init__(self, selections=None):
        self.selections = selections or {}

    def submitted_selections(self, attempt_id):
        return self.selections


def submitted_attempt(threshold=70):
    return SimpleNamespace(
        id=uuid4(),
        status="submitted",
        passing_threshold_pct=threshold,
    )


def test_missing_threshold_is_refused():
    attempt = submitted_attempt(threshold=None)
    session = FakeGradingSession(attempt, [])
    with pytest.raises(MissingThresholdError):
        GradingService(session, StubResponses()).grade_attempt(attempt.id)
    assert session.add_all_rows == [] and session.commits == 0


def test_in_progress_attempt_is_refused():
    attempt = submitted_attempt()
    attempt.status = "in_progress"
    session = FakeGradingSession(attempt, [])
    with pytest.raises(AttemptNotSubmittedError):
        GradingService(session, StubResponses()).grade_attempt(attempt.id)
    assert session.add_all_rows == [] and session.commits == 0


def test_grading_without_response_source_is_refused():
    attempt = submitted_attempt()
    session = FakeGradingSession(attempt, [])
    with pytest.raises(ResponseSourceUnavailableError):
        GradingService(session).grade_attempt(attempt.id)
    assert session.add_all_rows == [] and session.commits == 0


def test_regrading_returns_the_stored_result_and_writes_nothing():
    attempt = submitted_attempt()
    stored = ExamResult(attempt_id=attempt.id, points_earned=1, points_possible=1)
    session = FakeGradingSession(attempt, [[stored]])
    result = GradingService(session, StubResponses()).grade_attempt(attempt.id)

    assert result is stored
    assert session.add_all_rows == [] and session.add_rows == []
    assert session.commits == 0


def test_grading_persists_rows_in_one_commit():
    attempt = submitted_attempt(threshold=70)
    version_id = uuid4()
    correct_id = uuid4()
    pinned_row = SimpleNamespace(
        question_id=uuid4(),
        question_version_id=version_id,
        question_type="multiple_choice",
        allows_multiple_answers=False,
    )
    session = FakeGradingSession(
        attempt,
        exec_queue=[
            [],  # no stored result yet
            [pinned_row],  # pinned question versions
            [(version_id, correct_id)],  # trusted key rows
            [],  # no per-question rows exist yet
        ],
    )
    responses = StubResponses({version_id: [correct_id]})

    result = GradingService(session, responses).grade_attempt(attempt.id)

    assert session.commits == 1
    assert session.rollbacks == 0
    assert [g.outcome for g in session.add_all_rows] == ["correct"]
    assert session.add_all_rows[0].question_version_id == version_id
    assert (result.points_earned, result.points_possible) == (1, 1)
    assert result.threshold_pct == 70
    assert result.passed is True


def test_per_question_grades_are_never_duplicated():
    """Immediate feedback mode may already have graded one question.

    The final grading run must reuse those immutable rows for the scores
    while only persisting the versions not yet graded.
    """
    attempt = submitted_attempt(threshold=70)
    graded_version = uuid4()
    graded_key = uuid4()
    fresh_version = uuid4()
    fresh_key = uuid4()
    pinned = [
        SimpleNamespace(
            question_id=uuid4(),
            question_version_id=graded_version,
            question_type="multiple_choice",
            allows_multiple_answers=False,
        ),
        SimpleNamespace(
            question_id=uuid4(),
            question_version_id=fresh_version,
            question_type="multiple_choice",
            allows_multiple_answers=False,
        ),
    ]
    session = FakeGradingSession(
        attempt,
        exec_queue=[
            [],  # no stored attempt result yet
            pinned,  # pinned question versions
            [(graded_version, graded_key), (fresh_version, fresh_key)],
            [  # already-graded versions (immediate feedback mode):
                # single-column selects yield scalar version ids
                graded_version,
            ],
        ],
    )
    responses = StubResponses({graded_version: [graded_key], fresh_version: [uuid4()]})

    result = GradingService(session, responses).grade_attempt(attempt.id)

    inserted = [row.question_version_id for row in session.add_all_rows]
    assert inserted == [fresh_version]
    assert [row.outcome for row in session.add_all_rows] == ["incorrect"]
    assert result.points_earned == 1
    assert result.points_possible == 2
    assert result.passed is False
