"""Unit tests for two optional, local-only subject certifications."""

from contextlib import nullcontext
from dataclasses import replace
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
from scripts import seed_demo_subjects


class MemorySession:
    """In-memory SQLModel-like session for non-database seed tests."""

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


@pytest.fixture
def memory_db(monkeypatch):
    db = MemorySession()
    monkeypatch.setattr(seed_demo_subjects, "require_safe_local_database", lambda: None)
    monkeypatch.setattr(seed_demo_subjects, "Session", lambda _engine: db)
    return db


def test_exactly_two_certifications_three_categories_ten_questions_each():
    seed_demo_subjects.validate_bank()
    certs = seed_demo_subjects.CERTIFICATIONS
    assert len(certs) == 2
    assert all(len(cert.categories) == 3 for cert in certs)
    assert all(
        len(category.questions) == 10 for cert in certs for category in cert.categories
    )
    assert (
        sum(len(category.questions) for cert in certs for category in cert.categories)
        == 60
    )
    assert all(
        len(question.options) == 4 and question.explanation.strip()
        for cert in certs
        for category in cert.categories
        for question in category.questions
    )


def test_math_symbols_and_multilingual_text_are_present():
    # Check both prompts and options, including Unicode math symbols.
    math_all = " ".join(
        " ".join((question.prompt, *question.options, question.explanation))
        for category in seed_demo_subjects.CERTIFICATIONS[0].categories
        for question in category.questions
    )
    assert all(symbol in math_all for symbol in ("√", "π", "×", "≤", "²", "¾"))

    language_text = " ".join(
        " ".join((question.prompt, *question.options, question.explanation))
        for category in seed_demo_subjects.CERTIFICATIONS[1].categories
        for question in category.questions
    )
    assert all(
        symbol in language_text
        for symbol in (
            "¿",
            "ñ",
            "é",
            "こんにちは",
            "مرحبا",
            "谢谢",
            "안녕하세요",
            "नमस्ते",
            "спасибо",
        )
    )


def test_deterministic_uuids_are_unique_for_all_60_questions():
    ids = []
    for cert in seed_demo_subjects.CERTIFICATIONS:
        ids.append(seed_demo_subjects.subject_uuid(f"{cert.slug}/certification"))
        for category in cert.categories:
            key = f"{cert.slug}/{category.slug}"
            ids.append(seed_demo_subjects.subject_uuid(f"{key}/category"))
            for number in range(1, 11):
                ids.append(seed_demo_subjects.subject_uuid(f"{key}/question/{number}"))
                ids.append(seed_demo_subjects.subject_uuid(f"{key}/version/{number}"))
                for position in range(1, 5):
                    ids.append(
                        seed_demo_subjects.subject_uuid(
                            f"{key}/option/{number}/{position}"
                        )
                    )
    assert (
        len(ids) == 368
    )  # 2 certs + 6 categories + 60 questions + 60 versions + 240 options
    assert len(ids) == len(set(ids))


def test_seed_inserts_expected_records_and_is_idempotent(memory_db):
    assert seed_demo_subjects.seed() == {
        "users": 1,
        "certifications": 2,
        "categories": 6,
        "questions": 60,
        "question_versions": 60,
        "answer_options": 240,
    }
    assert all(value == 0 for value in seed_demo_subjects.seed().values())

    for cert in seed_demo_subjects.CERTIFICATIONS:
        cert_id = seed_demo_subjects.subject_uuid(f"{cert.slug}/certification")
        saved_cert = memory_db.get(Certification, cert_id)
        assert saved_cert.feedback_mode == "immediate"
        assert saved_cert.passing_threshold_pct == seed_demo_subjects.PASSING_THRESHOLD
        for category in cert.categories:
            key = f"{cert.slug}/{category.slug}"
            saved_category = memory_db.get(
                Category, seed_demo_subjects.subject_uuid(f"{key}/category")
            )
            assert saved_category.is_published is True
            assert saved_category.certification_id == cert_id
            for number, question in enumerate(category.questions, start=1):
                version_id = seed_demo_subjects.subject_uuid(f"{key}/version/{number}")
                saved_version = memory_db.get(QuestionVersion, version_id)
                assert saved_version.review_status == "approved"
                assert saved_version.publication_status == "active"
                assert saved_version.explanation == question.explanation
                assert saved_version.allows_multiple_answers == (
                    len(question.correct_positions) > 1
                )
                options = [
                    memory_db.get(
                        AnswerOption,
                        seed_demo_subjects.subject_uuid(
                            f"{key}/option/{number}/{position}"
                        ),
                    )
                    for position in range(1, 5)
                ]
                assert [opt.position for opt in options if opt.is_correct] == list(
                    question.correct_positions
                )

    assert not any(kind is ExamResponse for kind, _identifier in memory_db.rows)


def test_existing_unrelated_category_is_not_changed(memory_db):
    other = Category(
        id=uuid4(),
        certification_id=uuid4(),
        name="Previously published Agile demo",
        is_published=True,
    )
    memory_db.add(other)
    seed_demo_subjects.seed()
    assert memory_db.get(Category, other.id) is other
    assert other.is_published is True


def test_existing_demo_answer_key_conflicts_are_not_overwritten(memory_db):
    seed_demo_subjects.seed()
    first_key = "quant/arithmetic/option/1/2"
    option = memory_db.get(AnswerOption, seed_demo_subjects.subject_uuid(first_key))
    assert option.is_correct is True
    option.is_correct = False
    with pytest.raises(RuntimeError, match="Demo row conflict"):
        seed_demo_subjects.seed()


def test_unsafe_database_is_rejected(monkeypatch):
    def reject():
        raise RuntimeError("Refusing remote or production-looking database")

    monkeypatch.setattr(seed_demo_subjects, "require_safe_local_database", reject)
    with pytest.raises(RuntimeError, match="Refusing"):
        seed_demo_subjects.seed()


def test_bad_question_count_is_rejected(monkeypatch):
    original = seed_demo_subjects.CERTIFICATIONS
    category = original[0].categories[0]
    modified_category = replace(category, questions=category.questions[:-1])
    modified_cert = replace(
        original[0], categories=(modified_category, *original[0].categories[1:])
    )
    monkeypatch.setattr(
        seed_demo_subjects, "CERTIFICATIONS", (modified_cert, original[1])
    )
    with pytest.raises(ValueError, match="exactly 10 questions"):
        seed_demo_subjects.validate_bank()


def test_correct_wrong_and_multiple_answers_follow_backend_grading_rules():
    single = seed_demo_subjects.CERTIFICATIONS[0].categories[0].questions[0]
    multiple = seed_demo_subjects.CERTIFICATIONS[0].categories[0].questions[9]
    assert len(single.correct_positions) == 1
    assert len(multiple.correct_positions) > 1
    question1, version1, question2, version2 = (uuid4(), uuid4(), uuid4(), uuid4())
    options1 = [uuid4() for _ in range(4)]
    options2 = [uuid4() for _ in range(4)]
    pinned = [
        PinnedQuestion(
            question1,
            version1,
            "multiple_choice",
            False,
            [options1[position - 1] for position in single.correct_positions],
        ),
        PinnedQuestion(
            question2,
            version2,
            "multiple_choice",
            True,
            [options2[position - 1] for position in multiple.correct_positions],
        ),
    ]
    correct1 = options1[single.correct_positions[0] - 1]
    wrong1 = next(option for option in options1 if option != correct1)
    correct2 = [options2[position - 1] for position in multiple.correct_positions]
    good = compute_grades(pinned, {version1: [correct1], version2: correct2})
    bad = compute_grades(pinned, {version1: [wrong1], version2: correct2[:1]})
    assert (good.points_earned, good.points_possible) == (2, 2)
    assert (bad.points_earned, bad.points_possible) == (0, 2)
