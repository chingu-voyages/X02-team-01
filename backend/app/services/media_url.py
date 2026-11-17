"""Resolve safe object-storage keys to public media URLs."""

from urllib.parse import quote

from app.core.config import settings


def resolve_media_url(
    storage_key: str,
) -> str | None:
    """Return a public media URL for a safe object key.

    Invalid keys or an unconfigured media base return None so callers
    can provide an accessible fallback instead of exposing storage details.
    """

    base = settings.media_base_url
    parts = storage_key.split("/")

    if (
        not base
        or not parts
        or any(part in {"", ".", ".."} for part in parts)
        or any(
            "\\" in part
            or ":" in part
            or any(ord(character) < 32 for character in part)
            for part in parts
        )
    ):
        return None

    encoded_key = "/".join(
        quote(
            part,
            safe="",
        )
        for part in parts
    )

    return f"{base}/{encoded_key}"
