"""Validate question images before they are persisted or uploaded to R2."""

import warnings
from dataclasses import dataclass
from io import BytesIO

from PIL import Image, UnidentifiedImageError

from app.core.config import settings

MAX_ALT_TEXT_LENGTH = 1000

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
JPEG_SIGNATURE = b"\xff\xd8\xff"

SUPPORTED_IMAGE_FORMATS = {
    "PNG": {
        "media_type": "image/png",
        "extension": "png",
    },
    "JPEG": {
        "media_type": "image/jpeg",
        "extension": "jpg",
    },
    "WEBP": {
        "media_type": "image/webp",
        "extension": "webp",
    },
}


class QuestionImageValidationError(ValueError):
    """Base error for rejected question-image input."""


class QuestionImageTooLargeError(QuestionImageValidationError):
    """Uploaded bytes exceed the configured maximum."""


class QuestionImageUnsupportedTypeError(QuestionImageValidationError):
    """The uploaded bytes are not one of the supported image formats."""


class QuestionImageInvalidContentError(QuestionImageValidationError):
    """The uploaded bytes do not form a valid image."""


class QuestionImageDimensionsError(QuestionImageValidationError):
    """The image dimensions exceed the configured pixel limit."""


class QuestionImageAltTextError(QuestionImageValidationError):
    """Accessible alternative text is absent or invalid."""


@dataclass(frozen=True)
class ValidatedQuestionImage:
    """Safe image bytes and metadata ready for R2 persistence."""

    content: bytes
    media_type: str
    extension: str
    width: int
    height: int
    alt_text: str


def _detect_format(
    content: bytes,
) -> str:
    """Identify only the formats permitted by the question-media contract."""

    if content.startswith(PNG_SIGNATURE):
        return "PNG"

    if content.startswith(JPEG_SIGNATURE):
        return "JPEG"

    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "WEBP"

    raise QuestionImageUnsupportedTypeError(
        "Question images must be PNG, JPEG, or WebP"
    )


def _normalize_alt_text(
    alt_text: str,
) -> str:
    normalized = alt_text.strip()

    if not normalized:
        raise QuestionImageAltTextError("Image alt text is required")

    if len(normalized) > MAX_ALT_TEXT_LENGTH:
        raise QuestionImageAltTextError(
            f"Image alt text must not exceed {MAX_ALT_TEXT_LENGTH} characters"
        )

    return normalized


def validate_question_image(
    *,
    content: bytes,
    alt_text: str,
) -> ValidatedQuestionImage:
    """Validate bytes, format, dimensions, integrity, and accessibility text."""

    normalized_alt_text = _normalize_alt_text(
        alt_text,
    )

    if not content:
        raise QuestionImageInvalidContentError("Image file is empty")

    if len(content) > settings.max_question_image_bytes:
        raise QuestionImageTooLargeError(
            "Question image exceeds the maximum allowed size"
        )

    detected_format = _detect_format(
        content,
    )

    try:
        with warnings.catch_warnings():
            warnings.simplefilter(
                "error",
                Image.DecompressionBombWarning,
            )

            with Image.open(
                BytesIO(content),
                formats=[detected_format],
            ) as image:
                width, height = image.size

                if (
                    width <= 0
                    or height <= 0
                    or width * height > settings.max_question_image_pixels
                ):
                    raise QuestionImageDimensionsError(
                        "Question image dimensions exceed the maximum allowed size"
                    )

                image.verify()

    except QuestionImageDimensionsError:
        raise

    except (
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ) as exc:
        raise QuestionImageDimensionsError(
            "Question image dimensions exceed the maximum allowed size"
        ) from exc

    except (
        UnidentifiedImageError,
        OSError,
        SyntaxError,
        ValueError,
    ) as exc:
        raise QuestionImageInvalidContentError(
            "Question image content is invalid or corrupted"
        ) from exc

    format_metadata = SUPPORTED_IMAGE_FORMATS[detected_format]

    return ValidatedQuestionImage(
        content=content,
        media_type=format_metadata["media_type"],
        extension=format_metadata["extension"],
        width=width,
        height=height,
        alt_text=normalized_alt_text,
    )
