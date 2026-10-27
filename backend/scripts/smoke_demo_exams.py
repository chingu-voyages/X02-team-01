"""Exercise POST /api/v1/exams against a running local FastAPI server.

First seed a disposable local database and start uvicorn, then run:
    python -m scripts.smoke_demo_exams

Creates three demo attempts (5 PSM I, 5 Security+, 5 PSM I). Verifies HTTP
errors, source certification, saved order and answer-key non-disclosure.
"""

from __future__ import annotations

import argparse
import json
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from uuid import UUID

from sqlmodel import Session, select

from app.core.security import create_access_token
from app.db.session import engine
from app.models import ExamAttempt, ExamAttemptQuestion
from scripts.seed_demo_exams import (
    CERTIFICATIONS,
    DEMO_USER_ID,
    demo_uuid,
    require_safe_local_database,
)

FORBIDDEN_FIELDS = {
    "is_correct",
    "expected_answer",
    "review_status",
    "publication_status",
    "is_flagged",
    "review_note",
    "explanation",
}


def make_request(url: str, payload: dict, token: str | None) -> tuple[int, dict]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urlopen(request, timeout=15) as response:
            return response.status, json.loads(response.read())
    except HTTPError as error:
        return error.code, json.loads(error.read())
    except URLError as error:
        raise RuntimeError(
            "Cannot contact the API. Start 'uvicorn app.main:app --reload' "
            "in another terminal."
        ) from error


def validate_created(response: dict, cert_slug: str, count: int) -> UUID:
    cert_id = demo_uuid(f"{cert_slug}/certification")
    if response.get("status") != "in_progress":
        raise AssertionError("Unexpected exam status")
    if response.get("certification_id") != str(cert_id):
        raise AssertionError("Wrong certification in response")
    if response.get("question_count") != count:
        raise AssertionError("Wrong question count")
    questions = response.get("questions", [])
    if len(questions) != count:
        raise AssertionError("Wrong number of delivered questions")
    if [q["position"] for q in questions] != list(range(1, count + 1)):
        raise AssertionError("Question positions are not sequential")
    ids = [q["id"] for q in questions]
    if len(set(ids)) != count:
        raise AssertionError("Duplicate question versions in the exam")
    valid_versions = {
        str(demo_uuid(f"{cert_slug}/version/{number}")) for number in range(1, 16)
    }
    if not set(ids).issubset(valid_versions):
        raise AssertionError("Cross-certification or unseeded question delivered")
    for question in questions:
        if FORBIDDEN_FIELDS.intersection(question):
            raise AssertionError("Private question fields leaked")
        for option in question["options"]:
            if FORBIDDEN_FIELDS.intersection(option):
                raise AssertionError("Private option fields leaked")
    attempt_id = UUID(response["attempt_id"])
    with Session(engine) as session:
        stored = session.get(ExamAttempt, attempt_id)
        if stored is None or stored.user_id != DEMO_USER_ID:
            raise AssertionError("Attempt missing or incorrect owner")
        if stored.certification_id != cert_id or stored.question_count != count:
            raise AssertionError("Attempt metadata differs from API response")
        assigned = session.exec(
            select(ExamAttemptQuestion)
            .where(ExamAttemptQuestion.attempt_id == attempt_id)
            .order_by(ExamAttemptQuestion.position)
        ).all()
        if [(str(row.question_version_id), row.position) for row in assigned] != [
            (q["id"], q["position"]) for q in questions
        ]:
            raise AssertionError("Saved question assignments differ from response")
    return attempt_id


def count_attempts() -> int:
    with Session(engine) as session:
        return len(
            session.exec(
                select(ExamAttempt).where(ExamAttempt.user_id == DEMO_USER_ID)
            ).all()
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    parsed = urlparse(args.base_url)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"}:
        parser.error("Only HTTP calls to a local development API are supported")
    require_safe_local_database()
    endpoint = args.base_url.rstrip("/") + "/api/v1/exams"
    token = create_access_token(str(DEMO_USER_ID))

    expected_initial_attempts = count_attempts()
    for cert in (*CERTIFICATIONS, CERTIFICATIONS[0]):
        request_payload = {
            "certification_id": str(demo_uuid(f"{cert.slug}/certification")),
            "question_count": 5,
        }
        status, response = make_request(endpoint, request_payload, token)
        if status != 201:
            raise AssertionError(f"Expected HTTP 201, got {status}: {response}")
        attempt_id = validate_created(response, cert.slug, 5)
        print(f"PASS HTTP 201: {cert.code} -> attempt {attempt_id}")
        for item in response["questions"]:
            print(f"  {item['position']}. {item['question_text']}")

    first_cert = str(demo_uuid("psm1/certification"))
    too_many = {"certification_id": first_cert, "question_count": 20}
    status, body = make_request(endpoint, too_many, token)
    if status != 409 or body.get("detail", {}).get("code") != "INSUFFICIENT_QUESTIONS":
        raise AssertionError(f"Expected insufficient pool 409, got {status}: {body}")
    print("PASS HTTP 409: insufficient question pool")

    status, body = make_request(
        endpoint, {"certification_id": first_cert, "question_count": 0}, token
    )
    if status != 422:
        raise AssertionError(f"Expected invalid count 422, got {status}: {body}")
    print("PASS HTTP 422: invalid question count")

    status, body = make_request(
        endpoint, {"certification_id": first_cert, "question_count": 1}, None
    )
    if status != 401:
        raise AssertionError(f"Expected missing-token 401, got {status}: {body}")
    print("PASS HTTP 401: missing bearer token")

    if count_attempts() != expected_initial_attempts + 3:
        raise AssertionError("An invalid request created an unexpected attempt")
    print("PASS PostgreSQL: three attempts persisted, no partial attempts")
    print(
        "All local demo smoke checks passed. Tokens and answer keys were not printed."
    )


if __name__ == "__main__":
    main()
