from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.admin_question import QuestionDraftCreate, QuestionDraftEdit


def base_multiple_choice_payload() -> dict[str, object]:
    return {
        "certification_id": str(uuid4()),
        "category_id": str(uuid4()),
        "difficulty": "medium",
        "question_text": "Which statement is correct?",
        "question_type": "multiple_choice",
        "allows_multiple_answers": False,
        "explanation": "Because this is the correct statement.",
        "options": [
            {"option_text": "Correct answer", "is_correct": True},
            {"option_text": "Incorrect answer", "is_correct": False},
        ],
    }


def test_accepts_single_select_multiple_choice():
    payload = QuestionDraftCreate.model_validate(base_multiple_choice_payload())

    assert payload.question_type == "multiple_choice"
    assert payload.allows_multiple_answers is False
    assert len(payload.options) == 2
    assert sum(option.is_correct for option in payload.options) == 1


def test_accepts_multi_select_multiple_choice():
    data = base_multiple_choice_payload()
    data["allows_multiple_answers"] = True
    data["options"] = [
        {"option_text": "First", "is_correct": True},
        {"option_text": "Second", "is_correct": True},
        {"option_text": "Third", "is_correct": False},
    ]

    payload = QuestionDraftCreate.model_validate(data)

    assert payload.allows_multiple_answers is True
    assert sum(option.is_correct for option in payload.options) == 2


def test_accepts_short_answer():
    data = {
        "certification_id": str(uuid4()),
        "difficulty": "easy",
        "question_text": "What does MVP stand for?",
        "question_type": "short_answer",
        "expected_answer": "Minimum Viable Product",
    }

    payload = QuestionDraftCreate.model_validate(data)

    assert payload.question_type == "short_answer"
    assert payload.options == []
    assert payload.expected_answer == "Minimum Viable Product"


@pytest.mark.parametrize("question_text", ["", " ", "\n\t"])
def test_rejects_blank_question_text(question_text):
    data = base_multiple_choice_payload()
    data["question_text"] = question_text

    with pytest.raises(ValidationError):
        QuestionDraftCreate.model_validate(data)


@pytest.mark.parametrize("option_text", ["", " ", "\n\t"])
def test_rejects_blank_option_text(option_text):
    data = base_multiple_choice_payload()
    data["options"] = [
        {"option_text": option_text, "is_correct": True},
        {"option_text": "Other", "is_correct": False},
    ]

    with pytest.raises(ValidationError):
        QuestionDraftCreate.model_validate(data)


def test_rejects_multiple_choice_with_fewer_than_two_options():
    data = base_multiple_choice_payload()
    data["options"] = [{"option_text": "Only option", "is_correct": True}]

    with pytest.raises(ValidationError):
        QuestionDraftCreate.model_validate(data)


def test_rejects_multiple_choice_without_correct_option():
    data = base_multiple_choice_payload()
    data["options"] = [
        {"option_text": "First", "is_correct": False},
        {"option_text": "Second", "is_correct": False},
    ]

    with pytest.raises(ValidationError):
        QuestionDraftCreate.model_validate(data)


def test_rejects_multiple_correct_options_for_single_select():
    data = base_multiple_choice_payload()
    data["options"] = [
        {"option_text": "First", "is_correct": True},
        {"option_text": "Second", "is_correct": True},
    ]

    with pytest.raises(ValidationError):
        QuestionDraftCreate.model_validate(data)


def test_rejects_expected_answer_for_multiple_choice():
    data = base_multiple_choice_payload()
    data["expected_answer"] = "Correct answer"

    with pytest.raises(ValidationError):
        QuestionDraftCreate.model_validate(data)


def test_rejects_options_for_short_answer():
    data = {
        "certification_id": str(uuid4()),
        "difficulty": "easy",
        "question_text": "What does MVP stand for?",
        "question_type": "short_answer",
        "expected_answer": "Minimum Viable Product",
        "options": [{"option_text": "Not allowed", "is_correct": True}],
    }

    with pytest.raises(ValidationError):
        QuestionDraftCreate.model_validate(data)


def test_rejects_short_answer_without_expected_answer():
    data = {
        "certification_id": str(uuid4()),
        "difficulty": "easy",
        "question_text": "What does MVP stand for?",
        "question_type": "short_answer",
    }

    with pytest.raises(ValidationError):
        QuestionDraftCreate.model_validate(data)


def test_rejects_multiple_answer_flag_for_short_answer():
    data = {
        "certification_id": str(uuid4()),
        "difficulty": "easy",
        "question_text": "What does MVP stand for?",
        "question_type": "short_answer",
        "expected_answer": "Minimum Viable Product",
        "allows_multiple_answers": True,
    }

    with pytest.raises(ValidationError):
        QuestionDraftCreate.model_validate(data)


@pytest.mark.parametrize(
    "server_controlled_field",
    [
        "version_number",
        "review_status",
        "publication_status",
        "is_flagged",
        "submitted_by_id",
        "reviewed_by_id",
        "reviewed_at",
    ],
)
def test_rejects_client_controlled_workflow_fields(server_controlled_field):
    data = base_multiple_choice_payload()
    data[server_controlled_field] = "attacker-controlled"

    with pytest.raises(ValidationError):
        QuestionDraftCreate.model_validate(data)


def test_normalizes_human_text_fields():
    data = base_multiple_choice_payload()
    data["question_text"] = "  Question with accents: naïve résumé?  "
    data["explanation"] = "  Explanation ✓  "
    data["options"] = [
        {"option_text": "  Réponse correcte  ", "is_correct": True},
        {"option_text": "  Réponse incorrecte  ", "is_correct": False},
    ]

    payload = QuestionDraftCreate.model_validate(data)

    assert payload.question_text == "Question with accents: naïve résumé?"
    assert payload.explanation == "Explanation ✓"
    assert payload.options[0].option_text == "Réponse correcte"


def test_edit_payload_cannot_change_certification():
    data = {
        "category_id": str(uuid4()),
        "difficulty": "hard",
        "question_text": "Updated question",
        "question_type": "multiple_choice",
        "options": [
            {"option_text": "Yes", "is_correct": True},
            {"option_text": "No", "is_correct": False},
        ],
        "certification_id": str(uuid4()),
    }

    with pytest.raises(ValidationError):
        QuestionDraftEdit.model_validate(data)


def test_accepts_edit_payload():
    data = {
        "category_id": str(uuid4()),
        "difficulty": "hard",
        "question_text": "Updated question",
        "question_type": "multiple_choice",
        "options": [
            {"option_text": "Yes", "is_correct": True},
            {"option_text": "No", "is_correct": False},
        ],
    }

    payload = QuestionDraftEdit.model_validate(data)

    assert payload.difficulty == "hard"
    assert payload.question_text == "Updated question"
