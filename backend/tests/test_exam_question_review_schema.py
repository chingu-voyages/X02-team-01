"""Pure DTO checks; no database or web application is required."""

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.exam_question_review import (
    CompletedQuestionReviewOut,
    QuestionReviewGradeOut,
    SubmittedReviewResponseOut,
)


def payload(**changes):
    values = {
        "attempt_id": uuid4(),
        "question_count": 1,
        "question_version_id": uuid4(),
        "position": 1,
        "question_text": "原文 $x^2$",
        "question_type": "multiple_choice",
        "allows_multiple_answers": False,
        "question_status": "unanswered",
    }
    values.update(changes)
    return values


def test_empty_optional_sections_are_null_and_lists_are_independent():
    first = CompletedQuestionReviewOut(**payload())
    second = CompletedQuestionReviewOut(**payload())
    assert first.explanation is None
    assert first.submitted_response is None
    assert first.grading is None
    assert first.correct_option_ids is None
    assert first.images is not second.images
    assert first.options is not second.options


@pytest.mark.parametrize("status", ["in_progress", "draft", "cancelled"])
def test_detail_contract_cannot_describe_an_unfinished_attempt(status):
    with pytest.raises(ValidationError):
        CompletedQuestionReviewOut(**payload(attempt_status=status))


def test_submitted_response_contract_rejects_a_draft():
    with pytest.raises(ValidationError):
        SubmittedReviewResponseOut(is_submitted=False, answered_at=datetime.now(UTC))


@pytest.mark.parametrize("field", ["position", "question_count"])
@pytest.mark.parametrize("value", [0, -1])
def test_question_numbers_and_counts_must_be_positive(field, value):
    with pytest.raises(ValidationError):
        CompletedQuestionReviewOut(**payload(**{field: value}))


def test_written_text_and_mathematics_survive_json_round_trip():
    response = SubmittedReviewResponseOut(
        text_response="  原文 / مرحبا\n$x^2$ <not executable>  ",
        answered_at=datetime.now(UTC),
    )
    restored = SubmittedReviewResponseOut.model_validate_json(
        response.model_dump_json()
    )
    assert restored.text_response == response.text_response


def test_unknown_grading_outcome_is_rejected():
    with pytest.raises(ValidationError):
        QuestionReviewGradeOut(outcome="almost_correct", points_earned=1)


@pytest.mark.parametrize("field", ["points_earned", "max_points"])
def test_negative_score_values_are_rejected(field):
    values = {"outcome": "manually_graded", "points_earned": 1, "max_points": 2}
    values[field] = -1
    with pytest.raises(ValidationError):
        QuestionReviewGradeOut(**values)
