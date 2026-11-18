"""Tests for the local-only 3 x 10 learner journey question bank."""

from contextlib import nullcontext
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.models import (
    AnswerOption,
    Category,
    Certification,
    ExamResponse,
    QuestionVersion,
)
from app.services.grading_service import PinnedQuestion, compute_grades
from scripts import seed_demo_journey


class MemorySession:
    """Exercise idempotent inserts without touching a real database."""

    def __init__(self):
        self.rows: dict[tuple[type, object], object] = {}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def begin(self):
        return nullcontext()

    def get(self, model, identifier):
        return self.rows.get((model, identifier))

    def add(self, row):
        self.rows[(type(row), row.id)] = row

    def flush(self):
        pass

    def exec(self, _query):
        return SimpleNamespace(
            all=lambda: [
                row for (kind, _), row in self.rows.items() if kind is Category
            ]
        )


@pytest.fixture
def memory_db(monkeypatch):
    db = MemorySession()
    monkeypatch.setattr(seed_demo_journey, "require_safe_local_database", lambda: None)
    monkeypatch.setattr(seed_demo_journey, "Session", lambda _engine: db)
    return db


def test_bank_is_exactly_three_categories_with_ten_questions_each():
    seed_demo_journey.validate_bank()
    assert len(seed_demo_journey.CATEGORIES) == 3
    assert all(len(c.questions) == 10 for c in seed_demo_journey.CATEGORIES)
    assert sum(len(c.questions) for c in seed_demo_journey.CATEGORIES) == 30
    assert all(
        q.explanation.strip() and len(q.options) == 4
        for c in seed_demo_journey.CATEGORIES
        for q in c.questions
    )
    assert any(
        len(q.correct_positions) > 1
        for c in seed_demo_journey.CATEGORIES
        for q in c.questions
    )


def test_deterministic_ids_are_unique_across_all_categories():
    ids = [seed_demo_journey.journey_uuid("certification")]
    for category in seed_demo_journey.CATEGORIES:
        ids.append(seed_demo_journey.journey_uuid(f"{category.slug}/category"))
        for number in range(1, 11):
            ids.append(
                seed_demo_journey.journey_uuid(f"{category.slug}/question/{number}")
            )
            ids.append(
                seed_demo_journey.journey_uuid(f"{category.slug}/version/{number}")
            )
            ids.extend(
                seed_demo_journey.journey_uuid(
                    f"{category.slug}/option/{number}/{position}"
                )
                for position in range(1, 5)
            )
    assert len(ids) == len(set(ids))


def test_seed_inserts_all_records_and_is_idempotent(memory_db):
    first = seed_demo_journey.seed()
    assert first == {
        "users": 1,
        "certifications": 1,
        "categories": 3,
        "questions": 30,
        "question_versions": 30,
        "answer_options": 120,
        "other_categories_unpublished": 0,
    }
    assert all(value == 0 for value in seed_demo_journey.seed().values())

    cert = memory_db.get(Certification, seed_demo_journey.journey_uuid("certification"))
    assert cert.feedback_mode == "immediate"
    assert cert.passing_threshold_pct == 70
    assert (
        len([row for (kind, _), row in memory_db.rows.items() if kind is Category]) == 3
    )
    assert all(
        row.is_published
        for (kind, _), row in memory_db.rows.items()
        if kind is Category
    )
    assert not any(kind is ExamResponse for kind, _ in memory_db.rows)
    for category in seed_demo_journey.CATEGORIES:
        for number, item in enumerate(category.questions, start=1):
            version_id = seed_demo_journey.journey_uuid(
                f"{category.slug}/version/{number}"
            )
            version = memory_db.get(QuestionVersion, version_id)
            assert version.review_status == "approved"
            assert version.publication_status == "active"
            assert version.explanation == item.explanation
            options = [
                memory_db.get(
                    AnswerOption,
                    seed_demo_journey.journey_uuid(
                        f"{category.slug}/option/{number}/{p}"
                    ),
                )
                for p in range(1, 5)
            ]
            assert [o.position for o in options if o.is_correct] == list(
                item.correct_positions
            )


def test_seed_does_not_modify_unrelated_rows(memory_db):
    other = Category(
        id=uuid4(),
        certification_id=uuid4(),
        name="Unrelated organization",
        is_published=True,
    )
    memory_db.add(other)
    seed_demo_journey.seed()
    assert memory_db.get(Category, other.id) is other
    assert other.is_published is True


def test_optional_exclusive_catalog_unpublishes_old_categories(memory_db):
    older = Category(
        id=uuid4(),
        certification_id=uuid4(),
        name="Older published demo category",
        is_published=True,
    )
    memory_db.add(older)
    counts = seed_demo_journey.seed(show_only_journey_categories=True)
    assert counts["other_categories_unpublished"] == 1
    assert older.is_published is False
    assert all(
        memory_db.get(
            Category, seed_demo_journey.journey_uuid(f"{c.slug}/category")
        ).is_published
        for c in seed_demo_journey.CATEGORIES
    )
    again = seed_demo_journey.seed(show_only_journey_categories=True)
    assert all(value == 0 for value in again.values())


def test_seed_rejects_unsafe_database(monkeypatch):
    def reject():
        raise RuntimeError("Refusing remote or production-looking database")

    monkeypatch.setattr(seed_demo_journey, "require_safe_local_database", reject)
    with pytest.raises(RuntimeError, match="Refusing"):
        seed_demo_journey.seed()


def test_correct_wrong_and_multi_select_answers_are_graded_by_existing_engine():
    single = seed_demo_journey.CATEGORIES[0].questions[0]
    multi = seed_demo_journey.CATEGORIES[0].questions[3]
    assert len(single.correct_positions) == 1
    assert len(multi.correct_positions) > 1
    q1, v1, q2, v2 = uuid4(), uuid4(), uuid4(), uuid4()
    first_options = [uuid4() for _ in range(4)]
    second_options = [uuid4() for _ in range(4)]
    pinned = [
        PinnedQuestion(
            q1,
            v1,
            "multiple_choice",
            False,
            [first_options[i - 1] for i in single.correct_positions],
        ),
        PinnedQuestion(
            q2,
            v2,
            "multiple_choice",
            True,
            [second_options[i - 1] for i in multi.correct_positions],
        ),
    ]
    correct_single = first_options[single.correct_positions[0] - 1]
    wrong_single = next(option for option in first_options if option != correct_single)
    correct_multi = [second_options[i - 1] for i in multi.correct_positions]
    good = compute_grades(pinned, {v1: [correct_single], v2: correct_multi})
    wrong = compute_grades(pinned, {v1: [wrong_single], v2: correct_multi[:1]})
    assert good.points_earned == 2 and good.points_possible == 2
    assert wrong.points_earned == 0 and wrong.points_possible == 2
