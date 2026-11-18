"""Tests for the local demo catalog setup."""

from uuid import uuid4

import pytest

from app.models import Category, Certification
from scripts import prepare_demo_catalog
from scripts.seed_demo_exams import CERTIFICATIONS, demo_uuid


class FakeSession:
    def __init__(self, _engine, rows):
        self.rows = rows

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def begin(self):
        return self

    def get(self, model, identifier):
        return self.rows.get((model, identifier))


def demo_rows():
    rows = {}

    for demo in CERTIFICATIONS:
        cert_id = demo_uuid(f"{demo.slug}/certification")
        category_id = demo_uuid(f"{demo.slug}/category")

        rows[(Certification, cert_id)] = Certification(
            id=cert_id,
            code=demo.code,
            name=demo.name,
            feedback_mode="deferred",
            passing_threshold_pct=None,
        )

        rows[(Category, category_id)] = Category(
            id=category_id,
            certification_id=cert_id,
            name="Core concepts",
            is_published=False,
        )

    return rows


def test_publishes_demo_categories(monkeypatch):
    rows = demo_rows()
    unrelated = Category(
        id=uuid4(),
        certification_id=uuid4(),
        name="Unrelated",
    )
    rows[(Category, unrelated.id)] = unrelated

    monkeypatch.setattr(
        prepare_demo_catalog,
        "require_safe_local_database",
        lambda: None,
    )
    monkeypatch.setattr(
        prepare_demo_catalog,
        "Session",
        lambda engine: FakeSession(engine, rows),
    )

    changed = prepare_demo_catalog.prepare_demo_catalog()

    assert changed == len(CERTIFICATIONS) * 3
    assert prepare_demo_catalog.prepare_demo_catalog() == 0
    assert unrelated.is_published is False

    for demo in CERTIFICATIONS:
        cert = rows[(Certification, demo_uuid(f"{demo.slug}/certification"))]
        category = rows[(Category, demo_uuid(f"{demo.slug}/category"))]

        assert category.is_published is True
        assert cert.feedback_mode == "immediate"
        assert cert.passing_threshold_pct == 65


def test_rejects_unsafe_database(monkeypatch):
    def reject():
        raise RuntimeError("Unsafe database")

    monkeypatch.setattr(
        prepare_demo_catalog,
        "require_safe_local_database",
        reject,
    )

    with pytest.raises(RuntimeError, match="Unsafe database"):
        prepare_demo_catalog.prepare_demo_catalog()


def test_requires_seeded_data(monkeypatch):
    monkeypatch.setattr(
        prepare_demo_catalog,
        "require_safe_local_database",
        lambda: None,
    )
    monkeypatch.setattr(
        prepare_demo_catalog,
        "Session",
        lambda engine: FakeSession(engine, {}),
    )

    with pytest.raises(RuntimeError, match="Demo catalog is missing"):
        prepare_demo_catalog.prepare_demo_catalog()
