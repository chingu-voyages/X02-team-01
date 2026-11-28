"""JHEP-72 service unit tests; real PostgreSQL joins are tested separately."""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.services import exam_question_review_service as module
from app.services.exam_service import ExamAttemptNotFoundError
from app.services.grading_service import AttemptNotSubmittedError


@pytest.fixture
def review_case(monkeypatch):
    now = datetime.now(UTC)
    attempt = SimpleNamespace(id=uuid4(), status="submitted", question_count=4)
    version = SimpleNamespace(
        id=uuid4(),
        question_text="Original $x^2$ — 日本語 / مرحبا",
        question_type="multiple_choice",
        allows_multiple_answers=True,
        explanation="Original explanation: $x^2$\n日本語",
        publication_status="retired",
    )
    options = [
        SimpleNamespace(
            id=uuid4(), position=n, option_text=f"Option {n}", is_correct=n in (1, 3)
        )
        for n in range(1, 4)
    ]
    response = SimpleNamespace(
        is_submitted=True,
        selected_option_ids=[str(options[0].id)],
        text_response=None,
        answered_at=now,
        question_submitted_at=now,
    )
    grade = SimpleNamespace(
        outcome="incorrect", points_earned=0, max_points=1, feedback=None
    )
    image = SimpleNamespace(
        id=uuid4(),
        position=1,
        alt_text="Original diagram",
        media_type="image/png",
        storage_key="questions/original.png",
    )
    case = SimpleNamespace(
        attempt=attempt,
        version=version,
        options=options,
        response=response,
        grade=grade,
        images=[image],
        learner_id=uuid4(),
        pinned=SimpleNamespace(position=3),
        session=MagicMock(),
        owner=MagicMock(),
    )
    case.owner.get_owned_attempt.return_value = attempt
    monkeypatch.setattr(module, "ExamService", lambda session: case.owner)
    monkeypatch.setattr(
        module, "resolve_media_url", lambda key: f"https://media.test/{key}"
    )

    def prepare():
        row = MagicMock()
        row.first.return_value = (case.pinned, case.version, case.grade, case.response)
        results = [row]
        if case.version.question_type == "multiple_choice":
            result = MagicMock()
            result.all.return_value = case.options
            results.append(result)
        image_result = MagicMock()
        image_result.all.return_value = case.images
        results.append(image_result)
        case.session.exec.side_effect = results

    case.prepare = prepare

    def read():
        return module.ExamQuestionReviewService(case.session).read(
            attempt_id=case.attempt.id,
            question_version_id=case.version.id,
            learner_id=case.learner_id,
        )

    case.read = read
    prepare()
    return case


def test_returns_original_content_saved_response_and_full_key(review_case):
    case = review_case
    detail = case.read()
    assert detail.attempt_id == case.attempt.id
    assert detail.question_version_id == case.version.id
    assert detail.position == 3
    assert detail.question_count == 4
    assert detail.question_text == case.version.question_text
    assert detail.explanation == case.version.explanation
    assert detail.question_status == "incorrect"  # A correct subset is still incorrect.
    assert detail.submitted_response.selected_option_ids == [case.options[0].id]
    assert detail.correct_option_ids == [case.options[0].id, case.options[2].id]
    assert [option.id for option in detail.options] == [o.id for o in case.options]
    assert detail.images[0].alt_text == "Original diagram"
    assert detail.images[0].url == "https://media.test/questions/original.png"
    encoded = detail.model_dump_json()
    for private_field in ("storage_key", "review_note", "grader_role", "graded_by_id"):
        assert private_field not in encoded


def test_ownership_is_checked_before_any_content_read(review_case):
    case = review_case
    case.owner.get_owned_attempt.side_effect = ExamAttemptNotFoundError("not found")
    with pytest.raises(ExamAttemptNotFoundError):
        case.read()
    case.owner.get_owned_attempt.assert_called_once_with(
        attempt_id=case.attempt.id, learner_id=case.learner_id
    )
    case.session.exec.assert_not_called()


@pytest.mark.parametrize("status", ["in_progress", "draft", "cancelled"])
def test_only_submitted_attempts_release_detail(review_case, status):
    case = review_case
    case.attempt.status = status
    with pytest.raises(AttemptNotSubmittedError):
        case.read()
    case.session.exec.assert_not_called()


def test_unknown_or_unassigned_question_reads_no_key(review_case):
    case = review_case
    missing = MagicMock()
    missing.first.return_value = None
    case.session.exec.side_effect = [missing]
    with pytest.raises(ExamAttemptNotFoundError):
        case.read()
    assert case.session.exec.call_count == 1


def test_query_scopes_both_response_and_grade_to_attempt_and_version(review_case):
    case = review_case
    case.read()
    query = case.session.exec.call_args_list[0].args[0]
    sql = str(query)
    for fragment in (
        "exam_question_grades.attempt_id = exam_attempt_questions.attempt_id",
        "exam_question_grades.question_version_id = exam_attempt_questions.question_version_id",
        "exam_responses.attempt_id = exam_attempt_questions.attempt_id",
        "exam_responses.question_version_id = exam_attempt_questions.question_version_id",
        "exam_responses.is_submitted IS true",
    ):
        assert fragment in sql
    params = query.compile().params
    assert case.attempt.id in params.values()
    assert case.version.id in params.values()
    assert "publication_status" not in sql.split("WHERE", 1)[1]
    for call in case.session.exec.call_args_list[1:]:
        assert case.version.id in call.args[0].compile().params.values()


def test_get_performs_no_write_or_grading(review_case):
    case = review_case
    before = (list(case.response.selected_option_ids), case.grade.outcome)
    case.read()
    assert (case.response.selected_option_ids, case.grade.outcome) == before
    for name in ("add", "add_all", "delete", "flush", "commit", "rollback"):
        getattr(case.session, name).assert_not_called()
    case.session.no_autoflush.__enter__.assert_called_once()


@pytest.mark.parametrize("explanation", [None, "", " \n\t "])
def test_absent_explanation_is_null_not_empty_markup(review_case, explanation):
    review_case.version.explanation = explanation
    assert review_case.read().explanation is None


def test_missing_grade_does_not_trigger_regrading(review_case):
    case = review_case
    case.grade = None
    case.prepare()
    detail = case.read()
    assert detail.question_status == "unavailable"
    assert detail.grading is None
    assert detail.submitted_response.selected_option_ids == [case.options[0].id]


def test_unanswered_question_still_exposes_historical_key(review_case):
    case = review_case
    case.response = None
    case.grade.outcome = "unanswered"
    case.prepare()
    detail = case.read()
    assert detail.question_status == "unanswered"
    assert detail.submitted_response is None
    assert detail.correct_option_ids == [case.options[0].id, case.options[2].id]


def test_unsubmitted_draft_is_not_echoed(review_case):
    case = review_case
    case.response.is_submitted = False
    case.grade.outcome = "unanswered"
    assert case.read().submitted_response is None


def test_missing_answer_key_is_explicitly_unavailable(review_case):
    case = review_case
    for option in case.options:
        option.is_correct = False
    case.grade.outcome = "ungradable"
    detail = case.read()
    assert detail.correct_option_ids is None
    assert detail.question_status == "unavailable"


@pytest.mark.parametrize(
    "kind", ["malformed", "foreign", "duplicate", "empty", "not_list"]
)
def test_corrupt_recorded_selections_fail_without_silently_dropping_them(
    review_case, kind
):
    case = review_case
    choices = {
        "malformed": ["not-a-uuid"],
        "foreign": [str(uuid4())],
        "duplicate": [str(case.options[0].id)] * 2,
        "empty": [],
        "not_list": "not-a-list",
    }
    case.response.selected_option_ids = choices[kind]
    with pytest.raises(module.HistoricalReviewUnavailableError):
        case.read()


def test_missing_original_options_fail_safely(review_case):
    case = review_case
    case.options = []
    case.prepare()
    with pytest.raises(module.HistoricalReviewUnavailableError):
        case.read()


@pytest.mark.parametrize("outcome", ["ungraded", "manually_graded"])
def test_written_response_is_preserved_without_a_fake_binary_grade(
    review_case, outcome
):
    case = review_case
    case.version.question_type = "short_answer"
    case.version.allows_multiple_answers = False
    case.response.selected_option_ids = None
    case.response.text_response = "  My original answer\n日本語  "
    case.grade.outcome = outcome
    case.grade.points_earned = 2 if outcome == "manually_graded" else 0
    case.grade.max_points = 4
    case.grade.feedback = "Explain the trade-off."
    case.prepare()
    detail = case.read()
    assert detail.options == []
    assert detail.correct_option_ids is None
    assert detail.submitted_response.text_response == "  My original answer\n日本語  "
    assert detail.question_status == (
        "manually_graded" if outcome == "manually_graded" else "pending_manual_grading"
    )
    assert detail.grading.feedback == (
        "Explain the trade-off." if outcome == "manually_graded" else None
    )


def test_unconfigured_media_url_is_nullable_and_keeps_alt_text(
    review_case, monkeypatch
):
    monkeypatch.setattr(module, "resolve_media_url", lambda key: None)
    detail = review_case.read()
    assert detail.images[0].url is None
    assert detail.images[0].alt_text == "Original diagram"
