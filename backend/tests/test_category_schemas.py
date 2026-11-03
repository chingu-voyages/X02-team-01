"""Contract tests only; database availability rules are tested separately."""

from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.category import CategoryListOut, CategoryOut


@pytest.fixture
def category_payload() -> dict[str, object]:
    return {
        "id": str(uuid4()),
        "certification_id": str(uuid4()),
        "name": "Agile Fundamentals",
        "certification_name": "Agile Practice",
        "available_question_count": 20,
    }


def test_category_serializes_only_public_fields(category_payload):
    category = CategoryOut.model_validate(category_payload)

    assert category.model_dump(mode="json") == category_payload


@pytest.mark.parametrize("field", ["name", "certification_name"])
@pytest.mark.parametrize(
    "label",
    [
        "Agile Fundamentals",
        "Révision — méthodes agiles",
        "Überblick & Planung",
        "数学 ≥ 50% ± 5",
    ],
)
def test_category_preserves_unicode_labels(category_payload, field, label):
    category_payload[field] = label

    category = CategoryOut.model_validate(category_payload)

    assert getattr(category, field) == label


@pytest.mark.parametrize("field", ["name", "certification_name"])
def test_category_trims_surrounding_whitespace(category_payload, field):
    category_payload[field] = "  Agile Fundamentals  "

    category = CategoryOut.model_validate(category_payload)

    assert getattr(category, field) == "Agile Fundamentals"


@pytest.mark.parametrize("field", ["name", "certification_name"])
@pytest.mark.parametrize("label", ["", "   ", "\n\t", "x" * 256])
def test_category_rejects_invalid_labels(category_payload, field, label):
    category_payload[field] = label

    with pytest.raises(ValidationError):
        CategoryOut.model_validate(category_payload)


@pytest.mark.parametrize("field", ["name", "certification_name"])
def test_category_accepts_maximum_label_length(category_payload, field):
    category_payload[field] = "x" * 255

    category = CategoryOut.model_validate(category_payload)

    assert len(getattr(category, field)) == 255


@pytest.mark.parametrize("count", [0, -1, True, False, 1.5, "20", None])
def test_category_rejects_invalid_question_counts(category_payload, count):
    category_payload["available_question_count"] = count

    with pytest.raises(ValidationError):
        CategoryOut.model_validate(category_payload)


@pytest.mark.parametrize("count", [1, 20, 1000])
def test_category_accepts_positive_bank_counts(category_payload, count):
    category_payload["available_question_count"] = count

    category = CategoryOut.model_validate(category_payload)

    assert category.available_question_count == count


@pytest.mark.parametrize("field", ["id", "certification_id"])
def test_category_rejects_invalid_identifiers(category_payload, field):
    category_payload[field] = "not-a-uuid"

    with pytest.raises(ValidationError):
        CategoryOut.model_validate(category_payload)


@pytest.mark.parametrize("field", ["is_correct", "expected_answer", "answer_key"])
def test_category_rejects_unexpected_fields(category_payload, field):
    category_payload[field] = "private-data"

    with pytest.raises(ValidationError) as exc_info:
        CategoryOut.model_validate(category_payload)

    assert exc_info.value.errors()[0]["type"] == "extra_forbidden"


def test_category_list_supports_empty_results():
    response = CategoryListOut(categories=[])

    assert response.model_dump(mode="json") == {"categories": []}


def test_category_list_serializes_categories(category_payload):
    category = CategoryOut.model_validate(category_payload)
    response = CategoryListOut(categories=[category])

    assert response.model_dump(mode="json") == {"categories": [category_payload]}


def test_category_lists_do_not_share_defaults(category_payload):
    first = CategoryListOut()
    second = CategoryListOut()

    first.categories.append(CategoryOut.model_validate(category_payload))

    assert second.categories == []


def test_category_list_rejects_unexpected_wrapper_fields():
    with pytest.raises(ValidationError):
        CategoryListOut.model_validate({"categories": [], "answer_keys": []})
