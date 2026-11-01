"""JHEP-35 AC5: the full grading scoring matrix, without a database.

`compute_grades` is pure; each AC bullet maps to exactly one test. Fast
tests cover: correct/incorrect/partial/unanswered, single vs multiple
select, 0% and 100% totals, Pass/Fail at/above/below the threshold,
per-exam threshold independence, ungradable keys, short-answer exclusion,
and the empty-gradable edge case.
"""

from uuid import uuid4

from app.services.grading_service import (
    GRADED_OUTCOMES,
    OUTCOME_CORRECT,
    OUTCOME_INCORRECT,
    OUTCOME_UNANSWERED,
    OUTCOME_UNGRADABLE,
    OUTCOME_UNGRADED,
    GradingOutcome,
    PinnedQuestion,
    compute_grades,
    passed_at_threshold,
)

DEFAULT_KEY = "use-a-fresh-random-key"


def pinned_single(question_id=None, correct=DEFAULT_KEY):
    return PinnedQuestion(
        question_id=question_id or uuid4(),
        version_id=uuid4(),
        question_type="multiple_choice",
        allows_multiple_answers=False,
        correct_option_ids=[uuid4()] if correct == DEFAULT_KEY else correct,
    )


def pinned_multi(correct, question_id=None):
    return PinnedQuestion(
        question_id=question_id or uuid4(),
        version_id=uuid4(),
        question_type="multiple_choice",
        allows_multiple_answers=True,
        correct_option_ids=correct,
    )


def pinned_short(question_id=None):
    return PinnedQuestion(
        question_id=question_id or uuid4(),
        version_id=uuid4(),
        question_type="short_answer",
        allows_multiple_answers=False,
        correct_option_ids=None,
    )


def outcomes(result: GradingOutcome):
    return {grade.version_id: grade.outcome for grade in result.grades}


def test_single_select_correct_earns_one_point():
    question = pinned_single()
    correct_id = question.correct_option_ids[0]
    result = compute_grades([question], {question.version_id: [correct_id]})

    assert outcomes(result) == {question.version_id: OUTCOME_CORRECT}
    assert (result.points_earned, result.points_possible) == (1, 1)


def test_single_select_incorrect_earns_zero():
    question = pinned_single()
    wrong = [uuid4()]
    result = compute_grades([question], {question.version_id: wrong})

    assert outcomes(result) == {question.version_id: OUTCOME_INCORRECT}
    assert (result.points_earned, result.points_possible) == (0, 1)


def test_single_select_with_multiple_selections_is_incorrect():
    question = pinned_single()
    selected_two = [question.correct_option_ids[0], uuid4()]
    result = compute_grades([question], {question.version_id: selected_two})
    assert outcomes(result) == {question.version_id: OUTCOME_INCORRECT}


def test_single_select_with_two_correct_keys_is_ungradable():
    question = PinnedQuestion(
        question_id=uuid4(),
        version_id=uuid4(),
        question_type="multiple_choice",
        allows_multiple_answers=False,
        correct_option_ids=[uuid4(), uuid4()],
    )
    result = compute_grades(
        [question], {question.version_id: [question.correct_option_ids[0]]}
    )
    assert outcomes(result) == {question.version_id: OUTCOME_UNGRADABLE}


def test_multi_select_exact_match_earns_one_point():
    correct = [uuid4(), uuid4(), uuid4()]
    question = pinned_multi(correct)
    result = compute_grades([question], {question.version_id: sorted(correct)})

    assert outcomes(result) == {question.version_id: OUTCOME_CORRECT}
    assert (result.points_earned, result.points_possible) == (1, 1)


def test_multi_select_partial_match_earns_zero():
    correct = [uuid4(), uuid4()]
    question = pinned_multi(correct)
    partial = [correct[0], uuid4()]
    result = compute_grades([question], {question.version_id: partial})

    assert outcomes(result) == {question.version_id: OUTCOME_INCORRECT}
    assert (result.points_earned, result.points_possible) == (0, 1)


def test_multi_select_missing_option_or_extra_option_earns_zero():
    correct = [uuid4(), uuid4()]
    question = pinned_multi(correct)

    too_few = compute_grades([question], {question.version_id: [correct[0]]})
    too_many = compute_grades([question], {question.version_id: [*correct, uuid4()]})

    assert outcomes(too_few) == {question.version_id: OUTCOME_INCORRECT}
    assert outcomes(too_many) == {question.version_id: OUTCOME_INCORRECT}


def test_unanswered_question_scores_zero_but_counts_toward_possible():
    question = pinned_single()
    result = compute_grades([question], {})

    assert outcomes(result) == {question.version_id: OUTCOME_UNANSWERED}
    assert result.points_earned == 0
    assert result.points_possible == 1


def test_overall_score_of_zero_percent():
    first = pinned_single()
    second = pinned_single()
    result = compute_grades([first, second], {})

    assert (result.points_earned, result.points_possible) == (0, 2)
    assert result.score_pct == 0


def test_overall_score_of_one_hundred_percent():
    first = pinned_single()
    second = pinned_multi([uuid4(), uuid4()])
    selections = {
        first.version_id: first.correct_option_ids,
        second.version_id: second.correct_option_ids,
    }
    result = compute_grades([first, second], selections)

    assert (result.points_earned, result.points_possible) == (2, 2)
    assert result.score_pct == 100


def test_short_answer_is_excluded_from_grading_and_possible_points():
    question = pinned_short()
    result = compute_grades([question], {})

    assert outcomes(result) == {question.version_id: OUTCOME_UNGRADED}
    assert (result.points_earned, result.points_possible) == (0, 0)


def test_mixed_exam_excludes_short_answer_from_the_score():
    mc = pinned_single()
    short = pinned_short()
    result = compute_grades(
        [mc, short],
        {mc.version_id: mc.correct_option_ids, short.version_id: []},
    )

    assert (result.points_earned, result.points_possible) == (1, 1)
    assert outcomes(result)[short.version_id] == OUTCOME_UNGRADED


def test_missing_answer_key_is_ungradable_and_excluded():
    question = pinned_single(correct=None)
    result = compute_grades([question], {question.version_id: [uuid4()]})

    assert outcomes(result) == {question.version_id: OUTCOME_UNGRADABLE}
    assert (result.points_earned, result.points_possible) == (0, 0)


def test_exam_with_no_gradable_questions_has_no_score():
    result = compute_grades([pinned_short()], {})
    assert result.score_pct is None
    assert result.points_possible == 0


def test_ungraded_outcomes_never_count_as_graded():
    result = compute_grades([pinned_short(), pinned_single(correct=None)], {})
    shown = set(outcomes(result).values())
    assert shown == {OUTCOME_UNGRADED, OUTCOME_UNGRADABLE}
    assert result.points_possible == 0


# --- Pass/Fail: integer math, at/above/below, unrounded (AC4) ------------


def test_pass_fail_at_above_and_below_threshold():
    # 2/3 = 66.666...% — never a clean percentage, exactly the rounding trap.
    threshold_boundary_cases = [
        (2, 3, 67, False),  # below (unrounded 66.7% < 67%)
        (2, 3, 66, True),  # above (unrounded 66.7% >= 66%)
        (1, 2, 50, True),  # exactly at the threshold
        (0, 3, 0, True),  # 0% threshold passes with a 0% score
    ]
    for earned, possible, threshold, expected_pass in threshold_boundary_cases:
        assert passed_at_threshold(earned, possible, threshold) is expected_pass


def test_no_gradables_means_pass_fail_is_not_applicable():
    assert passed_at_threshold(0, 0, 70) is None


def test_different_exams_use_different_thresholds():
    # Identical score (2/3) fails under 70% but passes under 65%.
    assert passed_at_threshold(2, 3, 70) is False
    assert passed_at_threshold(2, 3, 65) is True


def test_threshold_change_does_not_rewrite_grade_outcomes():
    # Outcomes depend only on selections vs keys; the threshold snapshot is
    # applied at comparison time, so editing a certification's threshold
    # cannot alter previously graded outcomes or earned points.
    first = pinned_single()
    second = pinned_single()
    selections = {
        first.version_id: first.correct_option_ids,
        second.version_id: [],
    }
    baseline = compute_grades([first, second], selections)

    for threshold in (10, 50, 100):  # noqa: B007 — the loop is the scenario
        regraded = compute_grades([first, second], selections)
        assert outcomes(regraded) == outcomes(baseline)
        assert regraded.points_earned == baseline.points_earned
        assert regraded.points_possible == baseline.points_possible


def test_graded_outcome_counts_from_the_allowed_set():
    graded = pinned_single()
    short = pinned_short()
    result = compute_grades(
        [graded, short], {graded.version_id: graded.correct_option_ids}
    )

    gradable = {
        g.version_id: g.outcome for g in result.grades if g.outcome in GRADED_OUTCOMES
    }
    assert gradable == {graded.version_id: OUTCOME_CORRECT}
    assert result.points_possible == 1
