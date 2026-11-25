"""JHEP-203: real HTTP starts and concurrent PostgreSQL duplicate protection."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Barrier
from uuid import UUID

import test_jhep126_final_integration as pg_tests
import test_learner_published_exams as learner_tests
from sqlmodel import select
from test_jhep126_final_integration import pg_environment as pg_environment
from test_learner_published_exams import environment as environment

from app.models import ExamAttempt, ExamAttemptQuestion
from app.services.exam_service import AttemptInProgressError
from app.services.published_exam_service import PublishedExamService


def _published_pair(environment):
    client, session = environment
    admin = learner_tests._user(session, "administrator")
    learner = learner_tests._user(session)
    cert, category = learner_tests._seed_bank(session, admin)
    exam_ids = []
    for name in ("Data", "Programming"):
        exam = learner_tests._create_exam(
            client, admin, cert, category, count=2, name=name
        )
        assert learner_tests._publish(client, admin, exam["id"]).status_code == 200
        exam_ids.append(exam["id"])
    return client, session, learner, cert, category, exam_ids


def test_same_category_and_length_have_independent_attempts(environment):
    client, session, learner, cert, category, exam_ids = _published_pair(environment)

    def start(exam_id, user=learner):
        return learner_tests._start(
            client, user, cert, category, count=2, exam_id=exam_id
        )

    first, second = [start(exam_id) for exam_id in exam_ids]
    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    attempt_ids = [UUID(response.json()["attempt_id"]) for response in (first, second)]
    assert attempt_ids[0] != attempt_ids[1]

    for exam_id, attempt_id in zip(exam_ids, attempt_ids, strict=True):
        attempt = session.get(ExamAttempt, attempt_id)
        assert attempt.practice_exam_id == UUID(exam_id)
        assert attempt.status == "in_progress"
        duplicate = start(exam_id)
        assert duplicate.status_code == 409, duplicate.text
        assert duplicate.json()["detail"] == {
            "code": "ATTEMPT_IN_PROGRESS",
            "attempt_id": str(attempt_id),
        }
        assignments = session.exec(
            select(ExamAttemptQuestion).where(
                ExamAttemptQuestion.attempt_id == attempt_id
            )
        ).all()
        assert len(assignments) == 2

    # Another learner can independently start the same configured exam.
    other = learner_tests._user(session)
    other_start = start(exam_ids[0], other)
    assert other_start.status_code == 201, other_start.text
    assert UUID(other_start.json()["attempt_id"]) not in attempt_ids

    # Completing one attempt allows a retake without affecting the other.
    prior = session.get(ExamAttempt, attempt_ids[0])
    prior.status = "submitted"
    prior.submitted_at = datetime.now(UTC)
    session.add(prior)
    session.commit()
    retake = start(exam_ids[0])
    assert retake.status_code == 201, retake.text
    assert UUID(retake.json()["attempt_id"]) not in attempt_ids
    assert session.get(ExamAttempt, attempt_ids[0]).status == "submitted"
    assert session.get(ExamAttempt, attempt_ids[1]).status == "in_progress"
    assert start(exam_ids[1]).json()["detail"]["attempt_id"] == str(attempt_ids[1])
    assert len(session.exec(select(ExamAttempt)).all()) == 4


def test_legacy_attempt_is_preserved_but_does_not_block_published_exam(environment):
    client, session, learner, cert, category, exam_ids = _published_pair(environment)
    legacy = ExamAttempt(
        user_id=learner.id,
        certification_id=cert.id,
        question_count=2,
        status="in_progress",
    )
    session.add(legacy)
    session.commit()
    legacy_id = legacy.id

    started = learner_tests._start(
        client, learner, cert, category, count=2, exam_id=exam_ids[0]
    )
    assert started.status_code == 201, started.text
    new_id = UUID(started.json()["attempt_id"])
    assert new_id != legacy_id
    assert session.get(ExamAttempt, new_id).practice_exam_id == UUID(exam_ids[0])
    assert session.get(ExamAttempt, legacy_id).practice_exam_id is None
    assert session.get(ExamAttempt, legacy_id).status == "in_progress"


def test_ambiguous_legacy_start_requires_exact_exam_id(environment):
    client, session, learner, cert, category, exam_ids = _published_pair(environment)
    response = learner_tests._start(client, learner, cert, category, count=2)
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "PRACTICE_EXAM_UNAVAILABLE"
    assert session.exec(select(ExamAttempt)).all() == []

    # A legacy request still works when exactly one published exam matches.
    second = session.get(learner_tests.PracticeExam, UUID(exam_ids[1]))
    second.status = "unpublished"
    session.add(second)
    session.commit()
    unique = learner_tests._start(client, learner, cert, category, count=2)
    assert unique.status_code == 201, unique.text
    attempt = session.get(ExamAttempt, UUID(unique.json()["attempt_id"]))
    assert attempt.practice_exam_id == UUID(exam_ids[0])
    duplicate = learner_tests._start(
        client, learner, cert, category, count=2, exam_id=exam_ids[0]
    )
    assert duplicate.status_code == 409, duplicate.text
    assert duplicate.json()["detail"]["attempt_id"] == str(attempt.id)


def test_postgres_concurrent_starts_return_one_attempt_and_matching_conflict(
    pg_environment,
):
    client, sessions = pg_environment
    with sessions() as session:
        ids = pg_tests._seed_bank(session)
    draft = pg_tests._create(client, ids)
    assert draft.status_code == 201, draft.text
    exam_id = draft.json()["id"]
    assert pg_tests._publish(client, ids, exam_id, True).status_code == 200
    barrier = Barrier(2)

    def start():
        with sessions() as session:
            service = PublishedExamService(session)
            barrier.wait(timeout=10)
            try:
                created = service.create_exam(
                    learner_id=ids["learner_id"],
                    certification_id=ids["certification_id"],
                    category_id=ids["category_id"],
                    practice_exam_id=UUID(exam_id),
                    question_count=2,
                )
                return "created", created.attempt_id
            except AttemptInProgressError as exc:
                return "conflict", exc.existing_attempt_id

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(start) for _ in range(2)]
        outcomes = [future.result(timeout=20) for future in futures]
    assert {status for status, _ in outcomes} == {"created", "conflict"}
    assert outcomes[0][1] == outcomes[1][1]

    with sessions() as session:
        attempts = session.exec(select(ExamAttempt)).all()
        assert len(attempts) == 1
        assert attempts[0].id == outcomes[0][1]
        assert attempts[0].practice_exam_id == UUID(exam_id)
        assert len(session.exec(select(ExamAttemptQuestion)).all()) == 2
