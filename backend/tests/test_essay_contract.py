"""JHEP-120: question and response contracts, including legacy types."""

from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.admin_question import QuestionDraftCreate, QuestionDraftEdit
from app.schemas.exam import (
    MAX_TEXT_ANSWER_LENGTH,
    ExamQuestionOut,
    ResponseSaveRequest,
)
from app.schemas.question import QuestionOut


def draft():
    return {
        "certification_id": str(uuid4()),
        "difficulty": "medium",
        "question_type": "essay",
        "question_text": "Explain the advantages and limitations of a cache.",
        "expected_answer": "Discuss latency, consistency, and invalidation.",
    }


@pytest.mark.parametrize("schema", [QuestionDraftCreate, QuestionDraftEdit])
def test_essay_uses_existing_written_answer_configuration(schema):
    payload = draft()
    if schema is QuestionDraftEdit:
        # The edit contract retains difficulty but does not accept certification_id.
        payload = {k: v for k, v in payload.items() if k in schema.model_fields}
    question = schema.model_validate(payload)
    assert question.question_type == "essay"
    assert question.options == []
    assert question.allows_multiple_answers is False


@pytest.mark.parametrize(
    "invalid",
    [
        {"allows_multiple_answers": True},
        {"options": [{"option_text": "Not an essay option", "is_correct": True}]},
        {"expected_answer": None},
        {"expected_answer": " \n\t"},
        {"question_type": "unknown_type"},
    ],
)
def test_rejects_invalid_essay_configuration(invalid):
    with pytest.raises(ValidationError):
        QuestionDraftCreate.model_validate(draft() | invalid)


@pytest.mark.parametrize("question_type", ["multiple_choice", "short_answer", "essay"])
def test_learner_contract_supports_types_without_answer_key(question_type):
    values = {
        "id": uuid4(),
        "position": 1,
        "question_text": "A question",
        "question_type": question_type,
        "difficulty": "easy",
        "allows_multiple_answers": False,
        "options": [],
        "expected_answer": "Private model answer",
    }
    exam = ExamQuestionOut.model_validate(values)
    question = QuestionOut.model_validate(values | {"id": str(values["id"])})
    for item in (exam, question):
        assert item.question_type == question_type
        assert "expected_answer" not in item.model_dump()


@pytest.mark.parametrize(
    "value", ["  First paragraph.\n\nSecond paragraph.  ", "é 😀\n文字"]
)
def test_response_schema_preserves_exact_text(value):
    assert ResponseSaveRequest(text_response=value).text_response == value


@pytest.mark.parametrize("char", ["a", "😀"])
def test_response_schema_character_boundary(char):
    maximum = char * MAX_TEXT_ANSWER_LENGTH
    assert ResponseSaveRequest(text_response=maximum).text_response == maximum
    with pytest.raises(ValidationError):
        ResponseSaveRequest(text_response=maximum + char)
