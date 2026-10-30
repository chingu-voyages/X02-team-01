"""Grade multiple-choice answers for a submitted exam attempt (JHEP-35).

Scoring is computed by a pure function (`compute_grades`) so the acceptance
matrix runs without a database. `GradingService` loads the attempt's pinned
question versions, the trusted answer keys, and the learner's submitted
responses, scores them, and persists one row per graded question plus a
single attempt result. Regrading returns the stored result (idempotent),
so duplicate submissions can never create inconsistent records.

Answer keys and expected answers never leave this service for an
`in_progress` attempt; JHEP-34's submit flow authorizes the learner before
grading is invoked.
"""

from collections import defaultdict
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Protocol, runtime_checkable
from uuid import UUID

from sqlmodel import Session, select

from app.models import (
    AnswerOption,
    ExamAttempt,
    ExamAttemptQuestion,
    ExamQuestionGrade,
    ExamResult,
    QuestionVersion,
)

OUTCOME_CORRECT = "correct"
OUTCOME_INCORRECT = "incorrect"
OUTCOME_UNANSWERED = "unanswered"
OUTCOME_UNGRADED = "ungraded"
OUTCOME_UNGRADABLE = "ungradable"

GRADED_OUTCOMES = frozenset({OUTCOME_CORRECT, OUTCOME_INCORRECT, OUTCOME_UNANSWERED})
MULTIPLE_CHOICE = "multiple_choice"


class AttemptNotSubmittedError(Exception):
    """Grading is only allowed after final submission (AC4 key-safety)."""


class MissingThresholdError(Exception):
    """The attempt has no recorded passing threshold (pre-JHEP-35 attempts)."""


class ResponseSourceUnavailableError(Exception):
    """No JHEP-32 response source was wired into the grading service."""


@dataclass(frozen=True)
class PinnedQuestion:
    """A question version frozen into the attempt, with its trusted key."""

    question_id: UUID
    version_id: UUID
    question_type: str
    allows_multiple_answers: bool
    # None means the key is missing or invalid → the question is ungradable.
    correct_option_ids: list[UUID] | None


@dataclass(frozen=True)
class GradedQuestion:
    """The printable result for one pinned question."""

    question_id: UUID
    version_id: UUID
    outcome: str
    points_earned: int


@dataclass(frozen=True)
class GradingOutcome:
    """Pure scoring result: no database, no persistence side effects."""

    grades: list[GradedQuestion] = field(default_factory=list)
    points_earned: int = 0
    points_possible: int = 0

    @property
    def score_pct(self) -> Decimal | None:
        """Exact percentage suggestion; the integer fractions stay the
        authority for Pass/Fail (AC4: unrounded comparison)."""
        if self.points_possible == 0:
            return None
        raw = Decimal(self.points_earned * 100) / Decimal(self.points_possible)
        return raw.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def compute_grades(
    pinned: list[PinnedQuestion],
    submitted_selections: dict[UUID, list[UUID]],
) -> GradingOutcome:
    """Score every pinned question against its trusted answer key.

    Rules (AC1/AC2):
    - single-select: exactly one correct option selected → 1 point, else 0
    - multi-select: selected set must equal the correct set (strict exact
      match, no partial credit, no negative marking) → 1 point, else 0
    - unanswered: no submitted selection → 0 points, still counts toward
      possible points
    - short-answer versions are excluded from grading and possible points
    - missing/invalid keys are ungradable and excluded from possible points
    """
    grades: list[GradedQuestion] = []
    earned = 0
    possible = 0

    for item in pinned:
        if item.question_type != MULTIPLE_CHOICE:
            grades.append(
                GradedQuestion(
                    question_id=item.question_id,
                    version_id=item.version_id,
                    outcome=OUTCOME_UNGRADED,
                    points_earned=0,
                )
            )
            continue

        if not item.correct_option_ids or (
            item.allows_multiple_answers is False and len(item.correct_option_ids) != 1
        ):
            # Missing key, or an invalid single-select key (zero or multiple
            # correct options) — the configuration, not the learner, failed.
            grades.append(
                GradedQuestion(
                    question_id=item.question_id,
                    version_id=item.version_id,
                    outcome=OUTCOME_UNGRADABLE,
                    points_earned=0,
                )
            )
            continue

        selected = submitted_selections.get(item.version_id)
        if not selected:
            grades.append(
                GradedQuestion(
                    question_id=item.question_id,
                    version_id=item.version_id,
                    outcome=OUTCOME_UNANSWERED,
                    points_earned=0,
                )
            )
            possible += 1
            continue

        correct = item.correct_option_ids
        if item.allows_multiple_answers:
            is_correct = set(selected) == set(correct)
        else:
            is_correct = len(selected) == 1 and correct[0] == selected[0]

        points = 1 if is_correct else 0
        grades.append(
            GradedQuestion(
                question_id=item.question_id,
                version_id=item.version_id,
                outcome=OUTCOME_CORRECT if is_correct else OUTCOME_INCORRECT,
                points_earned=points,
            )
        )
        possible += 1
        earned += points

    return GradingOutcome(
        grades=grades,
        points_earned=earned,
        points_possible=possible,
    )


def passed_at_threshold(
    points_earned: int,
    points_possible: int,
    threshold_pct: int,
) -> bool | None:
    """Pass/Fail with integer math only (AC4: never a rounded percentage).

    `points_earned * 100 >= threshold_pct * points_possible` is exactly
    `earned / possible >= threshold / 100`. Returns None when the attempt
    had no gradable questions (AC2: no misleading result).
    """
    if points_possible == 0:
        return None
    return points_earned * 100 >= threshold_pct * points_possible


@runtime_checkable
class ResponseSource(Protocol):
    """Plug-in point for JHEP-32's saved answers.

    Must return only submitted selections for attempt-owned questions,
    keyed by the pinned `question_version_id`.
    """

    def submitted_selections(self, attempt_id: UUID) -> dict[UUID, list[UUID]]: ...


class GradingService:
    """Loads pinned versions, keys, and responses; persists one result."""

    def __init__(self, session: Session, responses: ResponseSource | None = None):
        self._session = session
        self._responses = responses

    def grade_attempt(self, attempt_id: UUID) -> ExamResult:
        """Grade a submitted attempt and store the result exactly once.

        Safe to call more than once: the second call returns the persisted
        row instead of creating duplicates (AC4).
        """
        attempt = self._session.get(ExamAttempt, attempt_id)
        if attempt is None:
            raise LookupError("Exam attempt not found")
        if attempt.status != "submitted":
            raise AttemptNotSubmittedError("Attempt must be submitted before grading")
        if attempt.passing_threshold_pct is None:
            raise MissingThresholdError("Attempt has no recorded passing threshold")
        if self._responses is None:
            raise ResponseSourceUnavailableError(
                "No response source configured (pending JHEP-32 integration)"
            )

        existing = self._session.exec(
            select(ExamResult).where(ExamResult.attempt_id == attempt_id)
        ).first()
        if existing is not None:
            return existing

        pinned = self._load_pinned_questions(attempt_id)
        response_map = self._responses.submitted_selections(attempt_id)
        outcome = compute_grades(pinned, response_map)
        return self._persist(attempt, outcome)

    def _load_pinned_questions(self, attempt_id: UUID) -> list[PinnedQuestion]:
        pinned_rows = self._session.exec(
            select(
                ExamAttemptQuestion.question_id,
                ExamAttemptQuestion.question_version_id,
                QuestionVersion.question_type,
                QuestionVersion.allows_multiple_answers,
            )
            .select_from(ExamAttemptQuestion)
            .join(
                QuestionVersion,
                ExamAttemptQuestion.question_version_id == QuestionVersion.id,
            )
            .where(ExamAttemptQuestion.attempt_id == attempt_id)
            .order_by(ExamAttemptQuestion.position)
        ).all()

        # One batched query for every correct option (nothing else is read).
        version_ids = [row.question_version_id for row in pinned_rows]
        correct_by_version: dict[UUID, list[UUID]] = defaultdict(list)
        if version_ids:
            key_rows = self._session.exec(
                select(AnswerOption.question_version_id, AnswerOption.id).where(
                    AnswerOption.question_version_id.in_(version_ids),
                    AnswerOption.is_correct.is_(True),
                )
            ).all()
            for version_id, option_id in key_rows:
                correct_by_version[version_id].append(option_id)

        pinned: list[PinnedQuestion] = []
        for row in pinned_rows:
            correct = correct_by_version.get(row.question_version_id)
            is_valid_key = correct is not None and (
                len(correct) == 1
                if not row.allows_multiple_answers
                else len(correct) >= 1
            )
            pinned.append(
                PinnedQuestion(
                    question_id=row.question_id,
                    version_id=row.question_version_id,
                    question_type=row.question_type,
                    allows_multiple_answers=row.allows_multiple_answers,
                    correct_option_ids=list(correct) if is_valid_key else None,
                )
            )
        return pinned

    def _persist(self, attempt: ExamAttempt, outcome: GradingOutcome) -> ExamResult:
        try:
            # Per-question rows may already exist when an attempt ran in
            # immediate feedback mode (each question was graded at its own
            # submit). Never duplicate them — the uniqueness constraint is
            # the app-level guard, existing rows stay immutable evidence.
            # SQLModel returns scalar values for single-column selects.
            already_graded = {
                *self._session.exec(
                    select(ExamQuestionGrade.question_version_id).where(
                        ExamQuestionGrade.attempt_id == attempt.id
                    )
                ).all()
            }
            self._session.add_all(
                [
                    ExamQuestionGrade(
                        attempt_id=attempt.id,
                        question_id=grade.question_id,
                        question_version_id=grade.version_id,
                        outcome=grade.outcome,
                        points_earned=grade.points_earned,
                    )
                    for grade in outcome.grades
                    if grade.version_id not in already_graded
                ]
            )
            threshold = attempt.passing_threshold_pct
            score_pct = (
                outcome.score_pct if outcome.score_pct is not None else Decimal(0)
            )
            result = ExamResult(
                attempt_id=attempt.id,
                points_earned=outcome.points_earned,
                points_possible=outcome.points_possible,
                score_pct=score_pct,
                threshold_pct=threshold,
                passed=passed_at_threshold(
                    outcome.points_earned,
                    outcome.points_possible,
                    threshold,
                ),
            )
            self._session.add(result)
            self._session.commit()
        except Exception:
            self._session.rollback()
            raise
        return result
