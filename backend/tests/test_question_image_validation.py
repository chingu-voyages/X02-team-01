from io import BytesIO

import pytest
from PIL import Image

from app.core.config import settings
from app.services.question_image_validation import (
    MAX_ALT_TEXT_LENGTH,
    QuestionImageAltTextError,
    QuestionImageDimensionsError,
    QuestionImageInvalidContentError,
    QuestionImageTooLargeError,
    QuestionImageUnsupportedTypeError,
    validate_question_image,
)


def image_bytes(
    image_format: str,
    *,
    width: int = 4,
    height: int = 4,
) -> bytes:
    buffer = BytesIO()

    mode = (
        "RGB"
        if image_format
        in {
            "JPEG",
            "WEBP",
        }
        else "RGBA"
    )

    Image.new(
        mode,
        (width, height),
        color="white",
    ).save(
        buffer,
        format=image_format,
    )

    return buffer.getvalue()


@pytest.mark.parametrize(
    (
        "image_format",
        "expected_media_type",
        "expected_extension",
    ),
    [
        (
            "PNG",
            "image/png",
            "png",
        ),
        (
            "JPEG",
            "image/jpeg",
            "jpg",
        ),
        (
            "WEBP",
            "image/webp",
            "webp",
        ),
    ],
)
def test_supported_images_are_validated(
    image_format,
    expected_media_type,
    expected_extension,
):
    content = image_bytes(
        image_format,
    )

    result = validate_question_image(
        content=content,
        alt_text="  Example diagram  ",
    )

    assert result.content == content
    assert result.media_type == (expected_media_type)
    assert result.extension == (expected_extension)
    assert result.width == 4
    assert result.height == 4
    assert result.alt_text == ("Example diagram")


def test_empty_file_is_rejected():
    with pytest.raises(
        QuestionImageInvalidContentError,
        match="empty",
    ):
        validate_question_image(
            content=b"",
            alt_text="Diagram",
        )


def test_unsupported_image_type_is_rejected():
    gif = b"GIF89a\x01\x00\x01\x00\x00" * 20

    with pytest.raises(
        QuestionImageUnsupportedTypeError,
        match="PNG, JPEG, or WebP",
    ):
        validate_question_image(
            content=gif,
            alt_text="Diagram",
        )


def test_non_image_content_is_rejected():
    with pytest.raises(
        QuestionImageUnsupportedTypeError,
    ):
        validate_question_image(
            content=b"this is not an image",
            alt_text="Diagram",
        )


def test_corrupt_png_is_rejected():
    corrupt_png = b"\x89PNG\r\n\x1a\nthis is not valid png data"

    with pytest.raises(
        QuestionImageInvalidContentError,
        match="invalid or corrupted",
    ):
        validate_question_image(
            content=corrupt_png,
            alt_text="Diagram",
        )


def test_file_over_size_limit_is_rejected(
    monkeypatch,
):
    monkeypatch.setattr(
        settings,
        "max_question_image_bytes",
        16,
    )

    content = b"\x89PNG\r\n\x1a\n" + b"x" * 20

    with pytest.raises(
        QuestionImageTooLargeError,
        match="maximum allowed size",
    ):
        validate_question_image(
            content=content,
            alt_text="Diagram",
        )


def test_pixel_limit_is_enforced(
    monkeypatch,
):
    monkeypatch.setattr(
        settings,
        "max_question_image_pixels",
        99,
    )

    content = image_bytes(
        "PNG",
        width=10,
        height=10,
    )

    with pytest.raises(
        QuestionImageDimensionsError,
        match="dimensions",
    ):
        validate_question_image(
            content=content,
            alt_text="Diagram",
        )


def test_blank_alt_text_is_rejected():
    with pytest.raises(
        QuestionImageAltTextError,
        match="required",
    ):
        validate_question_image(
            content=image_bytes(
                "PNG",
            ),
            alt_text="   ",
        )


def test_alt_text_length_is_limited():
    with pytest.raises(
        QuestionImageAltTextError,
        match="must not exceed",
    ):
        validate_question_image(
            content=image_bytes(
                "PNG",
            ),
            alt_text=("x" * (MAX_ALT_TEXT_LENGTH + 1)),
        )


def test_alt_text_is_trimmed():
    result = validate_question_image(
        content=image_bytes(
            "PNG",
        ),
        alt_text=("  Network topology diagram  "),
    )

    assert result.alt_text == ("Network topology diagram")
