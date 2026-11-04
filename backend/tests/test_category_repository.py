"""Category catalog and shared-selector regressions on disposable SQLite data.

These are query-behavior tests, not PostgreSQL migration/constraint tests.
Only the six required question-bank tables are copied into local metadata.
The PostgreSQL partial active-version index is mirrored for SQLite on that
copy; global application metadata is never changed.
"""

from collections.abc import Iterator
from contextlib import nullcontext
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from sqlalchemy import MetaData, event, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import OperationalError
from sqlmodel import Session, create_engine

from app.models import (
    AnswerOption,
    Category,
    Certification,
    Question,
    QuestionVersion,
    User,
)
from app.repositories.category_repository import SQLModelCategoryRepository
from app.repositories.question_eligibility import eligible_exam_questions_statement
from app.repositories.sqlmodel_repository import SQLModelQuestionRepository
from app.schemas.category import CategoryOut


@pytest.fixture
def catalog_session() -> Iterator[Session]:
    engine = create_engine("sqlite://")
    metadata = MetaData()
    for model in (
        User,
        Certification,
        Category,
        Question,
        QuestionVersion,
        AnswerOption,
    ):
        model.__table__.to_metadata(metadata)

    for index in metadata.tables["question_versions"].indexes:
        if index.name == "uq_question_versions_active_question":
            index.dialect_options["sqlite"]["where"] = text(
                "publication_status = 'active'"
            )

    try:
        with engine.connect() as connection:
            connection.exec_driver_sql("PRAGMA foreign_keys=ON")
            connection.commit()
            metadata.create_all(connection)
            connection.commit()
            with Session(connection, expire_on_commit=False) as session:
                yield session
    finally:
        engine.dispose()


@dataclass
class QuestionBank:
    session: Session
    author_id: UUID

    def certification(
        self,
        name: str = "Agile Practice",
        threshold: int | None = 70,
    ) -> Certification:
        row = Certification(
            name=name,
            code=f"test-{uuid4().hex}",
            passing_threshold_pct=threshold,
        )
        self.session.add(row)
        self.session.flush()
        return row

    def category(
        self,
        certification: Certification,
        name: str = "Fundamentals",
        *,
        published: bool = True,
    ) -> Category:
        row = Category(
            certification_id=certification.id,
            name=name,
            is_published=published,
        )
        self.session.add(row)
        self.session.flush()
        return row

    def question(
        self,
        certification: Certification,
        category: Category | None,
        **version_options,
    ) -> QuestionVersion:
        question = Question(
            certification_id=certification.id,
            category_id=category.id if category is not None else None,
            difficulty="easy",
            created_by_id=self.author_id,
        )
        self.session.add(question)
        self.session.flush()
        return self.version(question.id, **version_options)

    def version(
        self,
        question_id: UUID,
        *,
        version_number: int = 1,
        review: str = "approved",
        publication: str = "active",
        flagged: bool = False,
        question_type: str = "multiple_choice",
        multi: bool = False,
        options: tuple[bool, ...] = (True, False),
    ) -> QuestionVersion:
        reviewed = review != "pending"
        version = QuestionVersion(
            question_id=question_id,
            version_number=version_number,
            question_text="Which answer is correct?",
            question_type=question_type,
            allows_multiple_answers=multi,
            explanation="Private explanation; not catalog metadata.",
            review_status=review,
            publication_status=publication,
            is_flagged=flagged,
            submitted_by_id=self.author_id,
            reviewed_by_id=self.author_id if reviewed else None,
            reviewed_at=datetime.now(UTC) if reviewed else None,
        )
        self.session.add(version)
        self.session.flush()
        if question_type == "multiple_choice":
            self.session.add_all(
                [
                    AnswerOption(
                        question_version_id=version.id,
                        position=position,
                        option_text=f"Option {position}",
                        is_correct=correct,
                    )
                    for position, correct in enumerate(options, start=1)
                ]
            )
        self.session.flush()
        return version


@pytest.fixture
def bank(catalog_session: Session) -> QuestionBank:
    author = User(email=f"{uuid4().hex}@example.test")
    catalog_session.add(author)
    catalog_session.flush()
    return QuestionBank(catalog_session, author.id)


def _catalog(bank: QuestionBank, certification_id: UUID | None = None):
    # Persist fixture edits; the repository itself must never commit.
    bank.session.commit()
    return SQLModelCategoryRepository(bank.session).list_available(
        certification_id=certification_id
    )


def _selected(bank: QuestionBank, certification: Certification, count: int = 100):
    return SQLModelQuestionRepository(bank.session).select_random_eligible(
        certification_id=certification.id,
        question_count=count,
    )


def test_empty_database_returns_empty_list(bank):
    assert _catalog(bank) == []


def test_available_category_matches_public_response_contract(bank):
    cert = bank.certification()
    category = bank.category(cert)
    bank.question(cert, category)

    rows = _catalog(bank)

    assert len(rows) == 1
    payload = CategoryOut.model_validate(asdict(rows[0])).model_dump(mode="json")
    assert payload == {
        "id": str(category.id),
        "certification_id": str(cert.id),
        "name": category.name,
        "certification_name": cert.name,
        "available_question_count": 1,
    }


def test_unpublished_category_is_hidden_even_with_eligible_questions(bank):
    cert = bank.certification()
    category = bank.category(cert, published=False)
    bank.question(cert, category)

    assert _catalog(bank) == []


def test_missing_threshold_hides_category(bank):
    cert = bank.certification(threshold=None)
    category = bank.category(cert)
    bank.question(cert, category)

    assert _catalog(bank) == []


@pytest.mark.parametrize("threshold", [0, 70, 100])
def test_valid_thresholds_including_zero_do_not_hide_category(bank, threshold):
    cert = bank.certification(threshold=threshold)
    category = bank.category(cert)
    bank.question(cert, category)

    assert _catalog(bank)[0].available_question_count == 1


def test_category_without_questions_is_hidden(bank):
    cert = bank.certification()
    bank.category(cert)

    assert _catalog(bank) == []


@pytest.mark.parametrize(
    ("review", "publication", "flagged"),
    [
        ("pending", "draft", False),
        ("rejected", "draft", False),
        ("approved", "draft", False),
        ("approved", "retired", False),
        ("approved", "active", True),
    ],
)
def test_ineligible_statuses_are_excluded_from_catalog_and_selector(
    bank, review, publication, flagged
):
    cert = bank.certification()
    category = bank.category(cert)
    bank.question(
        cert, category, review=review, publication=publication, flagged=flagged
    )

    assert _catalog(bank) == []
    assert _selected(bank, cert) == []


@pytest.mark.parametrize(
    ("options", "multi", "expected"),
    [
        ((), False, 0),
        ((True,), False, 0),
        ((False, False), False, 0),
        ((True, True), False, 0),
        ((True, False), False, 1),
        ((True, False, False, False), False, 1),
        ((), True, 0),
        ((True,), True, 0),
        ((False, False), True, 0),
        ((True, False), True, 1),
        ((True, True, False), True, 1),
    ],
)
def test_option_validation_is_shared_by_catalog_and_selector(
    bank, options, multi, expected
):
    cert = bank.certification()
    category = bank.category(cert)
    bank.question(cert, category, options=options, multi=multi)

    catalog = _catalog(bank)
    count = catalog[0].available_question_count if catalog else 0

    assert count == expected
    assert len(_selected(bank, cert)) == expected


def test_counts_questions_not_options_or_historical_versions(bank):
    cert = bank.certification()
    category = bank.category(cert)
    old = bank.question(cert, category, publication="retired")
    active = bank.version(
        old.question_id, version_number=2, options=(True, False, False, False)
    )
    second = bank.question(cert, category)

    assert _catalog(bank)[0].available_question_count == 2
    assert {row.question_version_id for row in _selected(bank, cert)} == {
        active.id,
        second.id,
    }


def test_counts_stay_separate_across_categories_and_certifications(bank):
    first_cert = bank.certification("First certification")
    second_cert = bank.certification("Second certification")
    first = bank.category(first_cert, "Shared name")
    second = bank.category(first_cert, "Other topic")
    third = bank.category(second_cert, "Shared name")
    for cert, category, count in (
        (first_cert, first, 1),
        (first_cert, second, 2),
        (second_cert, third, 3),
    ):
        for _ in range(count):
            bank.question(cert, category)

    counts = {row.id: row.available_question_count for row in _catalog(bank)}

    assert counts == {first.id: 1, second.id: 2, third.id: 3}
    assert len(_selected(bank, first_cert)) == 3
    assert len(_selected(bank, second_cert)) == 3


def test_certification_filter_never_returns_another_certifications_categories(bank):
    first_cert = bank.certification("First")
    second_cert = bank.certification("Second")
    first = bank.category(first_cert)
    second = bank.category(second_cert)
    bank.question(first_cert, first)
    bank.question(second_cert, second)

    assert [row.id for row in _catalog(bank, first_cert.id)] == [first.id]
    assert _catalog(bank, uuid4()) == []


def test_uncategorized_questions_do_not_inflate_catalog_counts(bank):
    cert = bank.certification()
    category = bank.category(cert)
    bank.question(cert, category)
    bank.question(cert, None)

    assert _catalog(bank)[0].available_question_count == 1
    # Preserve existing certification-wide selection until start integration.
    assert len(_selected(bank, cert)) == 2


def test_short_answer_eligibility_remains_backward_compatible(bank):
    cert = bank.certification()
    category = bank.category(cert)
    version = bank.question(cert, category, question_type="short_answer")

    # Current selector does not require a TextAnswerKey: do not silently
    # introduce a new grading policy as part of this shared-query refactor.
    assert _catalog(bank)[0].available_question_count == 1
    assert _selected(bank, cert)[0].question_version_id == version.id


def test_pool_count_is_not_limited_to_the_maximum_exam_size(bank):
    cert = bank.certification()
    category = bank.category(cert)
    for _ in range(101):
        bank.question(cert, category, question_type="short_answer")

    assert _catalog(bank)[0].available_question_count == 101
    assert len(_selected(bank, cert, count=100)) == 100


def test_selector_preserves_limit_unique_ids_and_insufficient_pool_behavior(bank):
    cert = bank.certification()
    category = bank.category(cert)
    for _ in range(3):
        bank.question(cert, category)
    bank.session.commit()

    assert len(_selected(bank, cert, count=2)) == 2
    selected = _selected(bank, cert, count=10)
    assert len(selected) == 3
    assert len({row.question_id for row in selected}) == 3
    assert len({row.question_version_id for row in selected}) == 3


@pytest.mark.parametrize("count", [0, -1])
def test_selector_still_rejects_nonpositive_counts(bank, count):
    cert = bank.certification()
    with pytest.raises(ValueError, match="question_count must be positive"):
        _selected(bank, cert, count=count)


def test_sorting_is_deterministic_by_certification_then_category(bank):
    zulu = bank.certification("Zulu")
    alpha = bank.certification("Alpha")
    last = bank.category(zulu, "Basics")
    beta = bank.category(alpha, "beta")
    first = bank.category(alpha, "Alpha")
    for cert, category in ((zulu, last), (alpha, beta), (alpha, first)):
        bank.question(cert, category)

    expected = [first.id, beta.id, last.id]
    assert [row.id for row in _catalog(bank)] == expected
    assert [row.id for row in _catalog(bank)] == expected


def test_case_insensitive_sort_ties_have_stable_id_order(bank):
    cert = bank.certification()
    first = bank.category(cert, "Alpha")
    second = bank.category(cert, "alpha")
    bank.question(cert, first)
    bank.question(cert, second)

    assert [row.id for row in _catalog(bank)] == sorted([first.id, second.id])


@pytest.mark.parametrize(
    "name", ["Révision agile", "Überblick & Planung", "数学 ≥ 50%"]
)
def test_unicode_labels_survive_database_and_response_contract(bank, name):
    cert = bank.certification(name)
    category = bank.category(cert, name)
    bank.question(cert, category)

    summary = _catalog(bank)[0]
    payload = CategoryOut.model_validate(asdict(summary))
    assert payload.name == name
    assert payload.certification_name == name


def test_unpublishing_is_reflected_on_next_read(bank):
    cert = bank.certification()
    category = bank.category(cert)
    bank.question(cert, category)
    assert len(_catalog(bank)) == 1

    category.is_published = False
    bank.session.add(category)
    assert _catalog(bank) == []


def test_flagging_last_question_is_reflected_on_next_read(bank):
    cert = bank.certification()
    category = bank.category(cert)
    version = bank.question(cert, category)
    assert len(_catalog(bank)) == 1

    version.is_flagged = True
    bank.session.add(version)
    assert _catalog(bank) == []


def test_listing_is_one_select_and_does_not_flush_pending_work(bank):
    cert = bank.certification()
    for name in ("First", "Second", "Third"):
        category = bank.category(cert, name)
        bank.question(cert, category)
    bank.session.commit()
    pending = Category(
        certification_id=cert.id,
        name="Pending work must not be written by a read",
        is_published=False,
    )
    bank.session.add(pending)
    statements = []
    connection = bank.session.connection()

    def record_statement(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(connection, "before_cursor_execute", record_statement)
    try:
        rows = SQLModelCategoryRepository(bank.session).list_available()
    finally:
        event.remove(connection, "before_cursor_execute", record_statement)

    assert len(rows) == 3
    assert pending in bank.session.new
    assert len(statements) == 1
    assert statements[0].lstrip().upper().startswith("SELECT")
    assert "exam_attempts" not in statements[0]


def test_database_failure_is_not_disguised_as_an_empty_catalog():
    class UnavailableSession:
        no_autoflush = nullcontext()

        def exec(self, statement):
            raise OperationalError("SELECT", {}, RuntimeError("Database unavailable"))

    with pytest.raises(OperationalError):
        SQLModelCategoryRepository(UnavailableSession()).list_available()


def test_shared_statement_has_safe_columns_and_compiles_for_postgresql():
    statement = eligible_exam_questions_statement()
    sql = str(
        statement.compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": True},
        )
    )

    assert list(statement.selected_columns.keys()) == [
        "question_id",
        "question_version_id",
        "certification_id",
        "category_id",
    ]
    assert "'approved'" in sql
    assert "'active'" in sql
    assert " LIMIT " not in sql.upper()
    assert "ORDER BY" not in sql.upper()
