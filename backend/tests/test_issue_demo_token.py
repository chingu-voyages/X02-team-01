"""Tests for local demo JWT generation."""

import pytest

from app.core.security import decode_access_token
from app.models import User
from scripts import issue_demo_token
from scripts.seed_demo_exams import DEMO_USER_ID


class FakeSession:
    def __init__(self, learner):
        self.learner = learner

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def get(self, model, identifier):
        assert model is User
        assert identifier == DEMO_USER_ID
        return self.learner


def setup_fake_database(monkeypatch, learner):
    monkeypatch.setattr(
        issue_demo_token,
        "require_safe_local_database",
        lambda: None,
    )

    monkeypatch.setattr(
        issue_demo_token,
        "Session",
        lambda _engine: FakeSession(learner),
    )


def test_generates_valid_demo_jwt(monkeypatch):
    learner = User(
        id=DEMO_USER_ID,
        email="demo@example.test",
    )

    setup_fake_database(monkeypatch, learner)

    token = issue_demo_token.issue_demo_token()

    assert isinstance(token, str)
    assert decode_access_token(token) == str(DEMO_USER_ID)


def test_rejects_missing_demo_learner(monkeypatch):
    setup_fake_database(monkeypatch, None)

    with pytest.raises(
        RuntimeError,
        match="Demo learner not found",
    ):
        issue_demo_token.issue_demo_token()


def test_rejects_unsafe_database(monkeypatch):
    def reject():
        raise RuntimeError("Unsafe database")

    monkeypatch.setattr(
        issue_demo_token,
        "require_safe_local_database",
        reject,
    )

    with pytest.raises(RuntimeError, match="Unsafe database"):
        issue_demo_token.issue_demo_token()
