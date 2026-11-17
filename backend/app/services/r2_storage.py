"""Cloudflare R2 object-storage adapter for question images."""

from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import settings

QUESTION_IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable"


class R2ConfigurationError(RuntimeError):
    """R2 write access is unavailable because configuration is incomplete."""


class R2StorageError(RuntimeError):
    """A Cloudflare R2 object operation failed."""


class R2Storage:
    """Backend-only adapter around Cloudflare R2's S3-compatible API."""

    def __init__(
        self,
        *,
        client: Any | None = None,
        bucket_name: str | None = None,
    ) -> None:
        self._bucket_name = bucket_name or settings.r2_bucket_name

        if client is not None:
            if not self._bucket_name:
                raise R2ConfigurationError("R2 bucket name is not configured")

            self._client = client
            return

        missing = [
            name
            for name, value in (
                (
                    "R2_ACCOUNT_ID",
                    settings.r2_account_id,
                ),
                (
                    "R2_ACCESS_KEY_ID",
                    settings.r2_access_key_id,
                ),
                (
                    "R2_SECRET_ACCESS_KEY",
                    settings.r2_secret_access_key,
                ),
                (
                    "R2_BUCKET_NAME",
                    settings.r2_bucket_name,
                ),
            )
            if not value
        ]

        if missing:
            raise R2ConfigurationError("R2 write access is not configured")

        endpoint_url = f"https://{settings.r2_account_id}.r2.cloudflarestorage.com"

        self._client = boto3.client(
            service_name="s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=(settings.r2_access_key_id),
            aws_secret_access_key=(settings.r2_secret_access_key),
            region_name="auto",
        )

    def upload(
        self,
        *,
        key: str,
        content: bytes,
        media_type: str,
    ) -> None:
        """Create an immutable object without overwriting an existing key."""

        try:
            self._client.put_object(
                Bucket=self._bucket_name,
                Key=key,
                Body=content,
                ContentType=media_type,
                CacheControl=(QUESTION_IMAGE_CACHE_CONTROL),
                IfNoneMatch="*",
            )
        except (
            BotoCoreError,
            ClientError,
        ) as exc:
            raise R2StorageError("Unable to upload question image") from exc

    def delete(
        self,
        *,
        key: str,
    ) -> None:
        """Delete an object after callers confirm it is no longer referenced."""

        try:
            self._client.delete_object(
                Bucket=self._bucket_name,
                Key=key,
            )
        except (
            BotoCoreError,
            ClientError,
        ) as exc:
            raise R2StorageError("Unable to delete question image") from exc
