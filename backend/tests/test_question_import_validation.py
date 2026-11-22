from datetime import UTC, datetime
from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy.pool import StaticPool
from sqlmodel import (
    Session,
    SQLModel,
    create_engine,
)

from app.models.category import Category
from app.models.certification import Certification
from app.models.question import Question
from app.models.question_import_asset import QuestionImportAsset
from app.models.question_import_batch import QuestionImportBatch
from app.models.question_import_row import QuestionImportRow
from app.models.question_version import QuestionVersion
from app.models.user import User
from app.services.question_import_validation_service import (
    question_content_fingerprint,
    validate_question_import_batch,
)


def make_session() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={
            "check_same_thread": False,
        },
        poolclass=StaticPool,
    )

    @sa.event.listens_for(
        engine,
        "connect",
    )
    def enable_foreign_keys(
        dbapi_connection,
        _connection_record,
    ):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    SQLModel.metadata.create_all(
        engine,
        tables=[
            User.__table__,
            Certification.__table__,
            Category.__table__,
            Question.__table__,
            QuestionVersion.__table__,
            QuestionImportBatch.__table__,
            QuestionImportAsset.__table__,
            QuestionImportRow.__table__,
        ],
    )

    return Session(engine)


def seed_catalog(
    session: Session,
    *,
    certification_published: bool = True,
    category_published: bool = True,
):
    user = User(
        email=(f"{uuid4()}@example.test"),
        role="contributor",
    )
    certification = Certification(
        name=("AWS Cloud Practitioner"),
        code="CLF-C02",
        is_published=(certification_published),
    )

    session.add(user)
    session.add(certification)
    session.flush()

    category = Category(
        certification_id=(certification.id),
        name="Security",
        is_published=(category_published),
    )
    session.add(category)
    session.commit()

    return (
        user,
        certification,
        category,
    )


def create_batch(
    session: Session,
    *,
    uploader: User,
):
    batch = QuestionImportBatch(
        uploaded_by_id=(uploader.id),
        original_filename=("questions.xlsx"),
        file_type="xlsx",
        file_size_bytes=1024,
        file_sha256="a" * 64,
        template_version="2.0",
    )
    session.add(batch)
    session.commit()
    session.refresh(batch)

    return batch


def raw_mc(
    *,
    question_text: str = ("What is IAM?"),
    category_name: str | None = ("Security"),
    image_filename: str | None = None,
    image_alt_text: str | None = None,
):
    return {
        "template_version": "2.0",
        "certification_code": "CLF-C02",
        "category_name": (category_name),
        "difficulty": "medium",
        "question_type": ("multiple_choice"),
        "allows_multiple_answers": False,
        "question_text": (question_text),
        "option_a": ("Identity service"),
        "option_b": ("Object storage"),
        "option_c": None,
        "option_d": None,
        "option_e": None,
        "option_f": None,
        "correct_answers": "A",
        "expected_answer": None,
        "explanation": ("IAM manages access."),
        "image_filename": (image_filename),
        "image_alt_text": (image_alt_text),
    }


def issue_codes(
    row: QuestionImportRow,
):
    return {issue["code"] for issue in row.validation_issues}


def test_valid_multiple_choice_batch_is_ready():
    session = make_session()
    user, _, _ = seed_catalog(session)
    batch = create_batch(
        session,
        uploader=user,
    )

    row = QuestionImportRow(
        batch_id=batch.id,
        row_number=2,
        raw_payload=raw_mc(),
    )
    session.add(row)
    session.commit()

    result = validate_question_import_batch(
        session,
        batch_id=batch.id,
    )
    session.refresh(row)
    session.refresh(batch)

    assert result.can_import is True
    assert result.valid_rows == 1
    assert result.error_rows == 0
    assert batch.status == "ready"
    assert row.status == "valid"
    assert row.normalized_payload["question_text"] == "What is IAM?"
    assert row.content_fingerprint is not None


def test_short_answer_is_valid_with_warning():
    session = make_session()
    user, _, _ = seed_catalog(session)
    batch = create_batch(
        session,
        uploader=user,
    )

    payload = raw_mc()
    payload.update(
        {
            "question_type": ("short_answer"),
            "allows_multiple_answers": False,
            "option_a": None,
            "option_b": None,
            "correct_answers": None,
            "expected_answer": ("Identity and Access Management"),
        }
    )

    row = QuestionImportRow(
        batch_id=batch.id,
        row_number=2,
        raw_payload=payload,
    )
    session.add(row)
    session.commit()

    result = validate_question_import_batch(
        session,
        batch_id=batch.id,
    )
    session.refresh(row)

    assert result.can_import is True
    assert "SHORT_ANSWER_NOT_AUTO_GRADED" in issue_codes(row)


def test_missing_catalog_reference_blocks_batch():
    session = make_session()
    user, _, _ = seed_catalog(session)
    batch = create_batch(
        session,
        uploader=user,
    )

    payload = raw_mc()
    payload["certification_code"] = "UNKNOWN"

    row = QuestionImportRow(
        batch_id=batch.id,
        row_number=2,
        raw_payload=payload,
    )
    session.add(row)
    session.commit()

    result = validate_question_import_batch(
        session,
        batch_id=batch.id,
    )
    session.refresh(row)

    assert result.can_import is False
    assert "CERTIFICATION_NOT_FOUND" in issue_codes(row)
    assert row.status == "invalid"


def test_blank_category_is_warning_not_error():
    session = make_session()
    user, _, _ = seed_catalog(session)
    batch = create_batch(
        session,
        uploader=user,
    )

    row = QuestionImportRow(
        batch_id=batch.id,
        row_number=2,
        raw_payload=raw_mc(category_name=None),
    )
    session.add(row)
    session.commit()

    result = validate_question_import_batch(
        session,
        batch_id=batch.id,
    )
    session.refresh(row)

    assert result.can_import is True
    assert "CATEGORY_MISSING" in issue_codes(row)


def test_unpublished_catalog_is_warning():
    session = make_session()
    user, _, _ = seed_catalog(
        session,
        certification_published=False,
        category_published=False,
    )
    batch = create_batch(
        session,
        uploader=user,
    )

    row = QuestionImportRow(
        batch_id=batch.id,
        row_number=2,
        raw_payload=raw_mc(),
    )
    session.add(row)
    session.commit()

    result = validate_question_import_batch(
        session,
        batch_id=batch.id,
    )
    session.refresh(row)

    assert result.can_import is True
    assert "CATALOG_UNPUBLISHED" in issue_codes(row)


def test_option_gap_and_invalid_answer_reference_block_batch():
    session = make_session()
    user, _, _ = seed_catalog(session)
    batch = create_batch(
        session,
        uploader=user,
    )

    payload = raw_mc()
    payload.update(
        {
            "option_b": None,
            "option_c": "Third",
            "correct_answers": "D",
        }
    )

    row = QuestionImportRow(
        batch_id=batch.id,
        row_number=2,
        raw_payload=payload,
    )
    session.add(row)
    session.commit()

    result = validate_question_import_batch(
        session,
        batch_id=batch.id,
    )
    session.refresh(row)

    codes = issue_codes(row)

    assert result.can_import is False
    assert "OPTION_GAP" in codes
    assert "INVALID_ANSWER_REFERENCE" in codes


def test_math_mismatch_blocks_and_valid_math_warns():
    session = make_session()
    user, _, _ = seed_catalog(session)
    batch = create_batch(
        session,
        uploader=user,
    )

    invalid = QuestionImportRow(
        batch_id=batch.id,
        row_number=2,
        raw_payload=raw_mc(question_text=(r"Solve \(2x + 4 = 10.")),
    )
    valid = QuestionImportRow(
        batch_id=batch.id,
        row_number=3,
        raw_payload=raw_mc(question_text=(r"Solve \(2x + 4 = 10\).")),
    )

    session.add_all([invalid, valid])
    session.commit()

    result = validate_question_import_batch(
        session,
        batch_id=batch.id,
    )
    session.refresh(invalid)
    session.refresh(valid)

    assert result.can_import is False
    assert "MATH_DELIMITER_MISMATCH" in issue_codes(invalid)
    assert "MATH_PREVIEW_RECOMMENDED" in issue_codes(valid)


def test_missing_image_blocks_until_valid_asset_exists():
    session = make_session()
    user, _, _ = seed_catalog(session)
    batch = create_batch(
        session,
        uploader=user,
    )

    row = QuestionImportRow(
        batch_id=batch.id,
        row_number=2,
        raw_payload=raw_mc(
            image_filename=("VPC.PNG"),
            image_alt_text=("VPC diagram"),
        ),
    )
    session.add(row)
    session.commit()

    first = validate_question_import_batch(
        session,
        batch_id=batch.id,
    )
    session.refresh(row)

    assert first.can_import is False
    assert "MISSING_IMAGE_FILE" in issue_codes(row)

    asset = QuestionImportAsset(
        batch_id=batch.id,
        source_filename=("vpc.png"),
        normalized_filename=("vpc.png"),
        byte_size=123,
        sha256="b" * 64,
        media_type="image/png",
        status="valid",
    )
    session.add(asset)
    session.commit()

    second = validate_question_import_batch(
        session,
        batch_id=batch.id,
    )
    session.refresh(row)

    assert second.can_import is True
    assert row.matched_asset_id == asset.id


def test_unused_valid_asset_becomes_batch_warning():
    session = make_session()
    user, _, _ = seed_catalog(session)
    batch = create_batch(
        session,
        uploader=user,
    )

    row = QuestionImportRow(
        batch_id=batch.id,
        row_number=2,
        raw_payload=raw_mc(),
    )
    asset = QuestionImportAsset(
        batch_id=batch.id,
        source_filename=("unused.png"),
        normalized_filename=("unused.png"),
        byte_size=123,
        sha256="c" * 64,
        media_type="image/png",
        status="valid",
    )

    session.add_all([row, asset])
    session.commit()

    result = validate_question_import_batch(
        session,
        batch_id=batch.id,
    )

    assert result.unused_asset_filenames == ("unused.png",)
    assert result.warning_rows == 1


def test_duplicate_rows_mark_every_related_row_invalid():
    session = make_session()
    user, _, _ = seed_catalog(session)
    batch = create_batch(
        session,
        uploader=user,
    )

    first = QuestionImportRow(
        batch_id=batch.id,
        row_number=2,
        raw_payload=raw_mc(),
    )
    second = QuestionImportRow(
        batch_id=batch.id,
        row_number=3,
        raw_payload=raw_mc(),
    )

    session.add_all([first, second])
    session.commit()

    result = validate_question_import_batch(
        session,
        batch_id=batch.id,
    )
    session.refresh(first)
    session.refresh(second)

    assert result.can_import is False
    assert "DUPLICATE_IN_FILE" in issue_codes(first)
    assert "DUPLICATE_IN_FILE" in issue_codes(second)


def test_existing_question_duplicate_blocks_import():
    session = make_session()
    user, certification, category = seed_catalog(session)
    batch = create_batch(
        session,
        uploader=user,
    )

    question = Question(
        certification_id=(certification.id),
        category_id=(category.id),
        difficulty="medium",
        created_by_id=user.id,
    )
    session.add(question)
    session.flush()

    version = QuestionVersion(
        question_id=question.id,
        version_number=1,
        question_text="What is IAM?",
        question_type=("multiple_choice"),
        allows_multiple_answers=False,
        review_status="approved",
        publication_status="active",
        submitted_by_id=user.id,
        reviewed_by_id=user.id,
        reviewed_at=datetime.now(UTC),
    )
    session.add(version)
    session.commit()

    row = QuestionImportRow(
        batch_id=batch.id,
        row_number=2,
        raw_payload=raw_mc(),
    )
    session.add(row)
    session.commit()

    result = validate_question_import_batch(
        session,
        batch_id=batch.id,
    )
    session.refresh(row)

    assert result.can_import is False
    assert "DUPLICATE_IN_BANK" in issue_codes(row)
    assert row.duplicate_question_id == question.id


def test_fingerprint_uses_exact_contract_identity():
    certification_id = uuid4()
    category_id = uuid4()

    first = question_content_fingerprint(
        certification_id=(certification_id),
        category_id=(category_id),
        question_type=("multiple_choice"),
        question_text=("  What is IAM?  "),
    )

    same = question_content_fingerprint(
        certification_id=(certification_id),
        category_id=(category_id),
        question_type=("multiple_choice"),
        question_text=("What is IAM?"),
    )

    different_case = question_content_fingerprint(
        certification_id=(certification_id),
        category_id=(category_id),
        question_type=("multiple_choice"),
        question_text=("what is iam?"),
    )

    assert first == same
    assert first != different_case
