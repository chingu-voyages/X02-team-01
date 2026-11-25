"""Manual review and grading of written responses (JHEP-122).

The permission layer is JHEP-192's `can_grade_response_type` — every
route checks it per request (AC2/AC3: viewing AND grading are gated;
unauthorized direct requests fail safely with 403).

The flow (AC1–AC8):
- `pending_responses`: submitted text responses (short answers —
  essays join when JHEP-120 introduces the type) whose grade row is
  still `ungraded`, filtered to the reviewer's permitted type.
- `response_detail`: the saved learner response, the pinned question
  version, the answer key + rubric max, and the current grade state.
- `submit_final_grade`: score validation (0..rubric max), FOR UPDATE
  serialization of the grade row (the existing `ungraded` row is
  updated in place — only one latest final grade counts, AC8), the
  history append (AC5: previous grades preserved), the response
  mirror, and the attempt-result recalculation (the manual points
  join the final score and pass threshold — AC7/AC8).
- Provisional AI feedback (JHEP-182/194) does not exist yet; the
  service carries the seam (a response's provisional context is
  context-only — a human always submits the final grade, AC6).
"""

import logging
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal

from sqlmodel import Session, select

from app.models import (
    ExamQuestionGrade,
    ExamResponse,
    ManualGradeHistory,
    QuestionVersion,
    TextAnswerKey,
    User,
)
from app.services.admin_user_service import can_grade_response_type

logger = logging.getLogger(__name__)

GRADABLE_RESPONSE_TYPES = ("short_answer", "essay")


class GradingPermissionDeniedError(Exception):
    """The reviewer lacks the permission for this response type (AC3)."""


class ResponseNotFoundError(Exception):
    """The attempt/response/question combination does not exist."""


class ResponseNotGradableError(Exception):
    """The response is not in a gradable state (unsubmitted, etc.)."""


class InvalidScoreError(Exception):
    """The score is missing, non-numeric, or outside 0..rubric max (AC4)."""


def _response_type_of(version: QuestionVersion) -> str:
    return version.question_type


def _check_permission(actor: User, response_type: str, *, action: str) -> None:
    """AC2/AC3: the per-type permission gate for every operation."""
    if not can_grade_response_type(actor, response_type):
        raise GradingPermissionDeniedError(
            f"You do not have permission to {action} "
            f"{response_type.replace('_', ' ')} responses"
        )


def pending_responses(
    session: Session, *, actor: User, response_type: str | None = None
) -> list[dict]:
    """AC1: the pending manual-review queue — submitted text responses
    without a final grade, filtered to the reviewer's permitted types.
    Unauthorized types are silently absent (AC3: no leakage)."""
    permitted = [
        rtype
        for rtype in GRADABLE_RESPONSE_TYPES
        if can_grade_response_type(actor, rtype)
    ]
    if response_type:
        if response_type not in permitted:
            return []
        requested = [response_type]
    else:
        requested = permitted

    pending: list[dict] = []
    for rtype in requested:
        rows = session.exec(
            select(ExamResponse, QuestionVersion, ExamQuestionGrade)
            .join(
                QuestionVersion,
                QuestionVersion.id == ExamResponse.question_version_id,
            )
            .join(
                ExamQuestionGrade,
                (ExamQuestionGrade.attempt_id == ExamResponse.attempt_id)
                & (
                    ExamQuestionGrade.question_version_id
                    == ExamResponse.question_version_id
                ),
            )
            .where(
                ExamResponse.is_submitted.is_(True),  # type: ignore[attr-defined]
                ExamResponse.text_response.is_not(None),  # type: ignore[attr-defined]
                ExamQuestionGrade.outcome == "ungraded",
                QuestionVersion.question_type == rtype,
            )
        ).all()
        for response, version, _grade in rows:
            learner = session.get(User, _attempt_learner(session, response))
            pending.append(
                {
                    "attempt_id": str(response.attempt_id),
                    "question_version_id": str(response.question_version_id),
                    "response_type": rtype,
                    "learner_email": learner.email if learner else None,
                    "learner_name": learner.full_name if learner else None,
                    "question_preview": (
                        version.question_text[:120] if version else ""
                    ),
                    "submitted_at": (
                        response.question_submitted_at.isoformat()
                        if response.question_submitted_at
                        else None
                    ),
                    "max_points": _max_points(session, version),
                }
            )
    return pending


def _attempt_learner(session: Session, response: ExamResponse):
    from app.models import ExamAttempt

    attempt = session.get(ExamAttempt, response.attempt_id)
    return attempt.user_id if attempt else None


def _max_points(session: Session, version: QuestionVersion) -> int:
    key = session.exec(
        select(TextAnswerKey).where(TextAnswerKey.question_version_id == version.id)
    ).first()
    return key.max_points if key else 1


def response_detail(
    session: Session,
    *,
    actor: User,
    attempt_id,
    question_version_id,
) -> dict:
    """AC1: the saved learner response + the versioned answer key/rubric
    + the current grade state. Viewing is permission-gated (AC3)."""
    version = session.get(QuestionVersion, question_version_id)
    if version is None:
        raise ResponseNotFoundError("Response not found")

    response_type = _response_type_of(version)
    _check_permission(actor, response_type, action="view")

    response = session.exec(
        select(ExamResponse).where(
            ExamResponse.attempt_id == attempt_id,
            ExamResponse.question_version_id == question_version_id,
        )
    ).first()
    if response is None or not response.text_response:
        raise ResponseNotFoundError("Response not found")

    grade = session.exec(
        select(ExamQuestionGrade).where(
            ExamQuestionGrade.attempt_id == attempt_id,
            ExamQuestionGrade.question_version_id == question_version_id,
        )
    ).first()

    key = session.exec(
        select(TextAnswerKey).where(
            TextAnswerKey.question_version_id == question_version_id
        )
    ).first()

    history = session.exec(
        select(ManualGradeHistory)
        .where(
            ManualGradeHistory.attempt_id == attempt_id,
            ManualGradeHistory.question_version_id == question_version_id,
        )
        .order_by(ManualGradeHistory.created_at)
    ).all()

    return {
        "attempt_id": str(attempt_id),
        "question_version_id": str(question_version_id),
        "response_type": response_type,
        "question_text": version.question_text,
        "learner_response": response.text_response,
        "expected_answer": key.expected_answer if key else None,
        "max_points": key.max_points if key else 1,
        "current_grade": {
            "outcome": grade.outcome if grade else None,
            "points_earned": grade.points_earned if grade else None,
            "feedback": grade.feedback if grade else None,
            "graded_by_id": (
                str(grade.graded_by_id) if grade and grade.graded_by_id else None
            ),
            "grader_role": grade.grader_role if grade else None,
            "max_points": grade.max_points if grade else None,
            "graded_at": (
                grade.graded_at.isoformat() if grade and grade.graded_at else None
            ),
        }
        if grade
        else None,
        "history": [
            {
                "grader_role": h.grader_role,
                "action": h.action,
                "score": h.score,
                "max_points": h.max_points,
                "feedback": h.feedback,
                "created_at": h.created_at.isoformat(),
            }
            for h in history
        ],
        "provisional_ai_feedback": {
            "available": False,
            "label": "Provisional AI feedback — context only, not a final grade",
            "content": None,
        },
    }


def submit_final_grade(
    session: Session,
    *,
    actor: User,
    attempt_id,
    question_version_id,
    score,
    feedback: str | None,
) -> dict:
    """AC4/AC5/AC7/AC8: submit the final manual grade.

    Validates the score (integer, 0..rubric max), serializes the grade
    row with FOR UPDATE, updates it in place (manually_graded + the
    grader identity/role/timestamp), appends the history row, mirrors
    graded_at onto the response, and recalculates the attempt's
    ExamResult so the manual points join the final score.
    """
    version = session.get(QuestionVersion, question_version_id)
    if version is None:
        raise ResponseNotFoundError("Response not found")

    response_type = _response_type_of(version)
    _check_permission(actor, response_type, action="grade")

    response = session.exec(
        select(ExamResponse).where(
            ExamResponse.attempt_id == attempt_id,
            ExamResponse.question_version_id == question_version_id,
        )
    ).first()
    if response is None or not response.text_response:
        raise ResponseNotFoundError("Response not found")

    if response.is_submitted is not True:
        raise ResponseNotGradableError("Only submitted responses can be graded")

    # AC4: the score must be an integer within 0..rubric max.
    try:
        score_int = int(score)
    except (TypeError, ValueError) as exc:
        raise InvalidScoreError("The score must be a number") from exc
    if score_int != score:
        raise InvalidScoreError("The score must be a whole number")

    max_points = _max_points(session, version)
    if score_int < 0 or score_int > max_points:
        raise InvalidScoreError(f"The score must be between 0 and {max_points}")

    locked = session.exec(
        select(ExamQuestionGrade)
        .where(
            ExamQuestionGrade.attempt_id == attempt_id,
            ExamQuestionGrade.question_version_id == question_version_id,
        )
        .with_for_update()
    ).first()
    if locked is None:
        raise ResponseNotFoundError("Grade row not found")

    is_revision = locked.outcome == "manually_graded"
    graded_at = _utcnow()

    locked.outcome = "manually_graded"
    locked.points_earned = score_int
    locked.graded_by_id = actor.id
    locked.grader_role = actor.role
    locked.max_points = max_points
    locked.feedback = feedback
    locked.graded_at = graded_at
    session.add(locked)

    session.add(
        ManualGradeHistory(
            attempt_id=attempt_id,
            question_id=locked.question_id,
            question_version_id=question_version_id,
            graded_by_id=actor.id,
            grader_role=actor.role,
            action="revised" if is_revision else "graded",
            score=score_int,
            max_points=max_points,
            feedback=feedback,
        )
    )

    response.graded_at = graded_at
    session.add(response)

    _recalculate_attempt_result(session, attempt_id)
    try:
        session.commit()
    except Exception:
        session.rollback()
        raise

    logger.info(
        "Manual grade %s: attempt=%s version=%s score=%s/%s by %s (%s)",
        "revised" if is_revision else "recorded",
        attempt_id,
        question_version_id,
        score_int,
        max_points,
        actor.email,
        actor.role,
    )

    return {
        "attempt_id": str(attempt_id),
        "question_version_id": str(question_version_id),
        "outcome": "manually_graded",
        "score": score_int,
        "max_points": max_points,
        "feedback": feedback,
        "grader_role": actor.role,
        "action": "revised" if is_revision else "graded",
    }


def _recalculate_attempt_result(session: Session, attempt_id) -> None:
    """AC7/AC8: the manual points join the final score — recompute the
    attempt's ExamResult (earned/possible/score/passed) from the live
    grade rows, without rewriting the historical question versions."""
    from app.models import ExamAttempt, ExamResult
    from app.services.grading_service import passed_at_threshold

    grades = session.exec(
        select(ExamQuestionGrade).where(ExamQuestionGrade.attempt_id == attempt_id)
    ).all()

    points_earned = 0
    points_possible = 0
    for grade in grades:
        # Excluded: ungraded/ungradable written responses (the pre-manual
        # rows and the unavailable ones never count toward possible).
        if grade.outcome in ("ungraded", "ungradable"):
            continue
        points_earned += grade.points_earned
        points_possible += grade.max_points if grade.outcome == "manually_graded" else 1

    attempt = session.get(ExamAttempt, attempt_id)
    if attempt is None:
        return

    result = session.exec(
        select(ExamResult).where(ExamResult.attempt_id == attempt_id)
    ).first()
    if result is None:
        return

    result.points_earned = points_earned
    result.points_possible = points_possible
    result.score_pct = (
        (Decimal(points_earned * 100) / Decimal(points_possible)).quantize(
            Decimal("0.0001"), rounding=ROUND_HALF_UP
        )
        if points_possible > 0
        else Decimal(0)
    )
    result.threshold_pct = attempt.passing_threshold_pct
    result.passed = passed_at_threshold(
        points_earned, points_possible, attempt.passing_threshold_pct
    )
    session.add(result)


def _utcnow() -> datetime:
    return datetime.now(UTC)
