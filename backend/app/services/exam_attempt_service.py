"""Learner attempt lifecycle: save answers, submit questions/exams, results.

Implements the backend halves of JHEP-32 (save responses, navigate, resume)
and JHEP-34 (final submission) and the HTTP-facing grading flow for
JHEP-35. Scoring itself stays exclusively in `grading_service.py`.

Feedback modes (snapshotted onto the attempt at creation; fixed for the
attempt's lifetime — admin edits never change running attempts):
- ``immediate``: each question submit releases that question's own verdict,
  correct option ids and the post-submission explanation right away.
- ``deferred`` (default): nothing is released until after final submission.

Correctness data is never released for an in-progress attempt in deferred
mode, and the trusted answer key is disclosed only after final submission
in either mode.
"""

from collections import defaultdict
from datetime import UTC, datetime
from uuid import UUID

from sqlmodel import Session, select

from app.models import (
    AnswerOption,
    ExamAttempt,
    ExamAttemptQuestion,
    ExamQuestionGrade,
    ExamResponse,
    ExamResult,
    QuestionVersion,
)
from app.services.grading_service import (
    AttemptNotSubmittedError,
    GradedQuestion,
    GradingService,
    PinnedQuestion,
    compute_grades,
)

MC_TYPE = "multiple_choice"


class AttemptQuestionNotFoundError(LookupError):
    """The pinned question does not belong to this attempt."""


class QuestionAlreadyLockedError(ValueError):
    """The question was already individually submitted and cannot change."""


class AttemptAlreadySubmittedError(ValueError):
    """The exam was finally submitted; no edits or duplicate submits."""


class AttemptNotGradableError(ValueError):
    """The attempt has no recorded threshold snapshot (historical rows)."""


class NoAnswerContentError(ValueError):
    """A question submit arrived with neither selections nor text."""


class InvalidResponseContentError(ValueError):
    """Selections/text do not fit the pinned question's configuration."""


def _utcnow() -> datetime:
    return datetime.now(UTC)


class SavedAttemptResponses:
    """Concrete JHEP-32 response source handed to `GradingService`.

    Reads only `is_submitted` rows for the attempt and maps them to
    selections keyed by pinned question version id — exactly the shape the
    grading engine's contract requires.
    """

    def __init__(self, session: Session):
        self._session = session

    def submitted_selections(self, attempt_id: UUID) -> dict[UUID, list[UUID]]:
        rows = self._session.exec(
            select(ExamResponse).where(
                ExamResponse.attempt_id == attempt_id,
                ExamResponse.is_submitted.is_(True),
            )
        ).all()
        selections: dict[UUID, list[UUID]] = {}
        for row in rows:
            if row.selected_option_ids:
                selections[row.question_version_id] = [
                    UUID(item) for item in row.selected_option_ids
                ]
        return selections


def feedback_permitted(attempt: ExamAttempt, stage: str) -> bool:
    """Single disclosure gate (AC4): who may see correctness right now.

    - ``per_question`` stage: only in ``immediate`` mode, and only while the
      attempt is still in progress.
    - ``final_results`` stage: any submitted attempt — deferred mode permits
      disclosure from that point on.
    """
    if attempt.status == "submitted":
        return stage == "final_results"
    return stage == "per_question" and attempt.feedback_mode == "immediate"


class ExamAttemptService:
    """Owns saved responses, per-question submits, and final submission."""

    def __init__(self, session: Session):
        self._session = session

    # ------------------------------------------------------------------
    # Reading
    # ------------------------------------------------------------------

    def get_attempt(self, attempt_id: UUID) -> ExamAttempt:
        attempt = self._session.get(ExamAttempt, attempt_id)
        if attempt is None:
            raise LookupError("Exam attempt not found")
        return attempt

    def get_owned_attempt(self, *, attempt_id: UUID, learner_id: UUID) -> ExamAttempt:
        attempt = self.get_attempt(attempt_id)
        if attempt.user_id != learner_id:
            # Identical result for absent and foreign attempts: no probing.
            raise LookupError("Exam attempt not found")
        return attempt

    def response_blocks(self, attempt: ExamAttempt) -> dict[UUID, dict]:
        """Saved-response payloads for the resume endpoint, keyed by version.

        ``is_correct`` is included only when disclosure is permitted, so the
        resume payload never hints at correctness for an in-progress
        attempt in either feedback mode.
        """
        rows = self._session.exec(
            select(ExamResponse).where(ExamResponse.attempt_id == attempt.id)
        ).all()
        release = feedback_permitted(attempt, "final_results")
        blocks: dict[UUID, dict] = {}
        for row in rows:
            block = {
                "question_version_id": row.question_version_id,
                "selected_option_ids": [UUID(item) for item in row.selected_option_ids]
                if row.selected_option_ids
                else None,
                "text_response": row.text_response,
                "is_submitted": row.is_submitted,
                "answered_at": row.answered_at,
            }
            if release:
                block["is_correct"] = row.is_correct
            blocks[row.question_version_id] = block
        return blocks

    def answer_counts(self, attempt: ExamAttempt) -> tuple[int, int]:
        rows = self._session.exec(
            select(ExamResponse.attempt_id).where(ExamResponse.attempt_id == attempt.id)
        ).all()
        answered = len(rows)
        return answered, attempt.question_count - answered

    # ------------------------------------------------------------------
    # Saving (JHEP-32)
    # ------------------------------------------------------------------

    def _pinned_question(
        self, attempt_id: UUID, question_version_id: UUID
    ) -> ExamAttemptQuestion:
        row = self._session.exec(
            select(ExamAttemptQuestion).where(
                ExamAttemptQuestion.attempt_id == attempt_id,
                ExamAttemptQuestion.question_version_id == question_version_id,
            )
        ).first()
        if row is None:
            raise AttemptQuestionNotFoundError("Question not part of this attempt")
        return row

    def _existing_response(
        self, attempt_id: UUID, question_version_id: UUID
    ) -> ExamResponse | None:
        return self._session.exec(
            select(ExamResponse).where(
                ExamResponse.attempt_id == attempt_id,
                ExamResponse.question_version_id == question_version_id,
            )
        ).first()

    def save_response(
        self,
        attempt: ExamAttempt,
        question_version_id: UUID,
        *,
        selected_option_ids: list[UUID] | None,
        text_response: str | None,
        submit: bool = False,
    ) -> ExamResponse | None:
        """Create/replace/clear one question's saved answer.

        Empty content clears any existing draft (the question becomes
        unanswered). Locked rows (individually submitted questions) are
        immutable; a finally submitted attempt rejects everything.
        """
        if attempt.status == "submitted":
            raise AttemptAlreadySubmittedError("Attempt already submitted")

        pinned = self._pinned_question(attempt.id, question_version_id)
        question_type, _multiple = self._question_meta(question_version_id)
        existing = self._existing_response(attempt.id, question_version_id)
        if existing is not None and existing.is_submitted:
            raise QuestionAlreadyLockedError("Question already submitted")

        has_selections = bool(selected_option_ids)
        has_text = bool(text_response and text_response.strip())

        if not has_selections and not has_text:
            if submit:
                raise NoAnswerContentError("Cannot submit an empty answer")
            if existing is not None:
                self._session.delete(existing)
                self._session.commit()
            return None

        if has_selections and has_text:
            raise InvalidResponseContentError(
                "Provide either option selections or a text answer, not both"
            )
        if has_selections and question_type != MC_TYPE:
            raise InvalidResponseContentError(
                "This question does not accept option selections"
            )
        if has_text and question_type == MC_TYPE:
            raise InvalidResponseContentError(
                "This question does not accept a text answer"
            )

        selections: list[UUID] | None = None
        content: str | None = None
        if has_selections:
            # SQLModel returns scalar values for single-column selects.
            valid_ids = {
                *self._session.exec(
                    select(AnswerOption.id).where(
                        AnswerOption.question_version_id == question_version_id
                    )
                ).all()
            }
            unknown = set(selected_option_ids or []) - valid_ids
            if unknown:
                raise InvalidResponseContentError(
                    "Selections must belong to the presented question version"
                )
            if (
                not self._multiple_answers_allowed(question_version_id)
                and len(selected_option_ids or []) > 1
            ):
                raise InvalidResponseContentError(
                    "Only one option may be selected for this question"
                )
            selections = list(selected_option_ids or [])
        else:
            content = (text_response or "").strip()

        if existing is not None:
            existing.selected_option_ids = (
                [str(item) for item in selections] if selections else None
            )
            existing.text_response = content
            existing.answered_at = _utcnow()
            if submit:
                existing.is_submitted = True
                existing.question_submitted_at = _utcnow()
            row = existing
        else:
            row = ExamResponse(
                attempt_id=attempt.id,
                question_id=pinned.question_id,
                question_version_id=question_version_id,
                position=pinned.position,
                selected_option_ids=[str(item) for item in selections]
                if selections
                else None,
                text_response=content,
                is_submitted=submit,
                question_submitted_at=_utcnow() if submit else None,
            )
            self._session.add(row)
        self._session.commit()
        self._session.refresh(row)
        return row

    def _question_meta(self, question_version_id: UUID):
        """question_type + allows_multiple_answers of the pinned version."""
        row = self._session.exec(
            select(
                QuestionVersion.question_type,
                QuestionVersion.allows_multiple_answers,
            ).where(QuestionVersion.id == question_version_id)
        ).first()
        if row is None:
            raise AttemptQuestionNotFoundError("Question not part of this attempt")
        question_type, allows_multiple = row
        return question_type, allows_multiple

    def _multiple_answers_allowed(self, question_version_id: UUID) -> bool:
        return self._question_meta(question_version_id)[1]

    # ------------------------------------------------------------------
    # Per-question submit (JHEP-34 flow + JHEP-35 immediate feedback)
    # ------------------------------------------------------------------

    def submit_question(
        self,
        attempt: ExamAttempt,
        question_version_id: UUID,
        *,
        selected_option_ids: list[UUID] | None,
        text_response: str | None,
    ) -> dict:
        """Lock one question's answer and (in immediate mode) grade it now."""
        if attempt.status == "submitted":
            raise AttemptAlreadySubmittedError("Attempt already submitted")

        existing = self._existing_response(attempt.id, question_version_id)
        if existing is not None and existing.is_submitted:
            raise QuestionAlreadyLockedError("Question already submitted")

        row = self.save_response(
            attempt,
            question_version_id,
            selected_option_ids=selected_option_ids,
            text_response=text_response,
            submit=True,
        )
        if row is None:  # pragma: no cover - save_response raises instead
            raise NoAnswerContentError("Cannot submit an empty answer")

        immediate = feedback_permitted(attempt, "per_question")
        pinned = self._pinned_question(attempt.id, question_version_id)
        question_type, allows_multiple = self._question_meta(question_version_id)
        correct = (
            self._correct_options(question_version_id)
            if question_type == MC_TYPE
            else []
        )
        explanation = self._explanation(question_version_id)

        if immediate and question_type == MC_TYPE and row.is_correct is None:
            # Grade exactly this question once, reusing the trusted engine.
            item = PinnedQuestion(
                question_id=pinned.question_id,
                version_id=pinned.question_version_id,
                question_type=question_type,
                allows_multiple_answers=allows_multiple,
                correct_option_ids=correct,
            )
            outcome = compute_grades(
                [item],
                SavedAttemptResponses(self._session).submitted_selections(attempt.id),
            )
            grade = outcome.grades[0]
            self._persist_single_grade(attempt, grade)
            row.is_correct = grade.outcome == "correct"
            row.graded_at = _utcnow()
            self._session.add(row)
            self._session.commit()
            self._session.refresh(row)
        elif immediate and question_type != MC_TYPE:
            # Short answers are excluded from automatic grading; the
            # explanation is still released immediately.
            self._persist_single_grade(
                attempt,
                GradedQuestion(
                    question_id=pinned.question_id,
                    version_id=pinned.question_version_id,
                    outcome="ungraded",
                    points_earned=0,
                ),
            )

        return {
            "question_submitted_at": row.question_submitted_at,
            "feedback_released": immediate,
            "is_correct": row.is_correct if immediate else None,
            "correct_option_ids": correct if immediate else None,
            "explanation": explanation if immediate else None,
        }

    def _persist_single_grade(
        self,
        attempt: ExamAttempt,
        grade,  # GradedQuestion or equivalent minimal duck type
    ) -> None:
        """Persist one per-question grade row; existing rows are immutable."""
        exists = self._session.exec(
            select(ExamQuestionGrade.id).where(
                ExamQuestionGrade.attempt_id == attempt.id,
                ExamQuestionGrade.question_version_id == grade.version_id,
            )
        ).first()
        if exists is not None:
            return
        self._session.add(
            ExamQuestionGrade(
                attempt_id=attempt.id,
                question_id=grade.question_id,
                question_version_id=grade.version_id,
                outcome=grade.outcome,
                points_earned=grade.points_earned,
            )
        )
        self._session.commit()

    def _correct_options(self, question_version_id: UUID) -> list[UUID]:
        rows = self._session.exec(
            select(AnswerOption.id).where(
                AnswerOption.question_version_id == question_version_id,
                AnswerOption.is_correct.is_(True),
            )
        ).all()
        return list(rows)

    def _explanation(self, question_version_id: UUID) -> str | None:
        row = self._session.exec(
            select(QuestionVersion.explanation).where(
                QuestionVersion.id == question_version_id
            )
        ).first()
        return row

    # ------------------------------------------------------------------
    # Navigation (JHEP-32)
    # ------------------------------------------------------------------

    def apply_progress(self, attempt: ExamAttempt, current_position: int) -> None:
        if attempt.status == "submitted":
            raise AttemptAlreadySubmittedError("Attempt already submitted")
        if not 1 <= current_position <= attempt.question_count:
            raise InvalidResponseContentError(
                "current_position is outside the exam's question range"
            )
        attempt.current_position = current_position
        self._session.add(attempt)
        self._session.commit()
        self._session.refresh(attempt)

    # ------------------------------------------------------------------
    # Final submission (JHEP-34) and grading trigger
    # ------------------------------------------------------------------

    def final_submit(self, attempt: ExamAttempt) -> ExamResult:
        """Flip the attempt to `submitted` and grade it exactly once."""
        if attempt.status == "submitted":
            raise AttemptAlreadySubmittedError("Attempt already submitted")
        if attempt.passing_threshold_pct is None:
            raise AttemptNotGradableError("Attempt has no recorded threshold")

        attempt.status = "submitted"
        attempt.submitted_at = _utcnow()
        self._session.add(attempt)
        self._session.commit()
        self._session.refresh(attempt)

        grading = GradingService(
            self._session, responses=SavedAttemptResponses(self._session)
        )
        result = grading.grade_attempt(attempt.id)

        # Mirror the persisted per-question outcomes onto the responses so
        # the results/review experience has one consistent truth (deferred
        # mode discloses correctness from this moment on).
        outcome_by_version = {
            row.question_version_id: row.outcome
            for row in self._session.exec(
                select(ExamQuestionGrade).where(
                    ExamQuestionGrade.attempt_id == attempt.id
                )
            ).all()
        }
        for row in self._session.exec(
            select(ExamResponse).where(ExamResponse.attempt_id == attempt.id)
        ).all():
            if row.is_correct is not None:
                continue  # Already graded by immediate per-question feedback.
            grade = outcome_by_version.get(row.question_version_id)
            if grade in ("correct", "incorrect"):
                row.is_correct = grade == "correct"
                row.graded_at = _utcnow()
                self._session.add(row)
        self._session.commit()
        self._session.refresh(attempt)
        return result

    # ------------------------------------------------------------------
    # Results (JHEP-35 delivery)
    # ------------------------------------------------------------------

    def results_payload(self, attempt: ExamAttempt) -> dict:
        """Aggregate the persisted result + per-question rows for HTTP."""
        result = self._session.exec(
            select(ExamResult).where(ExamResult.attempt_id == attempt.id)
        ).first()
        if result is None:
            raise AttemptNotSubmittedError("Attempt must be submitted first")

        counts = defaultdict(int)
        for outcome in self._session.exec(
            select(ExamQuestionGrade.outcome).where(
                ExamQuestionGrade.attempt_id == attempt.id
            )
        ).all():
            counts[outcome] += 1

        answered, unanswered = self.answer_counts(attempt)
        return {
            "attempt_id": attempt.id,
            "certification_id": attempt.certification_id,
            "status": attempt.status,
            "question_count": attempt.question_count,
            "answered_count": answered,
            "unanswered_count": unanswered,
            "correct_count": counts["correct"],
            "incorrect_count": counts["incorrect"],
            "unanswered_graded_count": counts["unanswered"],
            "ungraded_count": counts["ungraded"],
            "ungradable_count": counts["ungradable"],
            # Gradables: everything except excluded (ungraded/ungradable).
            "graded_count": counts["correct"]
            + counts["incorrect"]
            + counts["unanswered"],
            "points_earned": result.points_earned,
            "points_possible": result.points_possible,
            "score_percent": float(result.score_pct)
            if result.points_possible > 0
            else None,
            "score_basis": "graded_questions_only",
            "passing_score_percent": attempt.passing_threshold_pct,
            "passed": result.passed,
            "grading_complete": True,
            "submitted_at": attempt.submitted_at,
            "graded_at": result.graded_at,
        }
