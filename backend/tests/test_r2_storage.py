from typing import Any

import boto3
import pytest
from botocore.exceptions import ClientError

from app.core.config import settings
from app.services.r2_storage import (
    QUESTION_IMAGE_CACHE_CONTROL,
    R2ConfigurationError,
    R2Storage,
    R2StorageError,
)


class FakeR2Client:
    def __init__(self) -> None:
        self.put_calls: list[dict[str, Any]] = []

        self.delete_calls: list[dict[str, Any]] = []

    def put_object(
        self,
        **kwargs,
    ):
        self.put_calls.append(kwargs)

    def delete_object(
        self,
        **kwargs,
    ):
        self.delete_calls.append(kwargs)


def test_upload_creates_immutable_object():
    client = FakeR2Client()

    storage = R2Storage(
        client=client,
        bucket_name="question-images",
    )

    storage.upload(
        key=("questions/version-id/image-id.webp"),
        content=b"image-bytes",
        media_type="image/webp",
    )

    assert client.put_calls == [
        {
            "Bucket": ("question-images"),
            "Key": ("questions/version-id/image-id.webp"),
            "Body": b"image-bytes",
            "ContentType": ("image/webp"),
            "CacheControl": (QUESTION_IMAGE_CACHE_CONTROL),
            "IfNoneMatch": "*",
        }
    ]


def test_delete_removes_requested_object():
    client = FakeR2Client()

    storage = R2Storage(
        client=client,
        bucket_name="question-images",
    )

    storage.delete(
        key=("questions/version-id/image-id.webp"),
    )

    assert client.delete_calls == [
        {
            "Bucket": ("question-images"),
            "Key": ("questions/version-id/image-id.webp"),
        }
    ]


def test_client_uses_cloudflare_r2_endpoint(
    monkeypatch,
):
    captured: dict[
        str,
        Any,
    ] = {}

    fake_client = FakeR2Client()

    def fake_boto_client(
        *args,
        **kwargs,
    ):
        captured["args"] = args
        captured["kwargs"] = kwargs
        return fake_client

    monkeypatch.setattr(
        boto3,
        "client",
        fake_boto_client,
    )

    monkeypatch.setattr(
        settings,
        "r2_account_id",
        "account-123",
    )

    monkeypatch.setattr(
        settings,
        "r2_access_key_id",
        "access-key",
    )

    monkeypatch.setattr(
        settings,
        "r2_secret_access_key",
        "secret-key",
    )

    monkeypatch.setattr(
        settings,
        "r2_bucket_name",
        "question-images",
    )

    storage = R2Storage()

    assert storage is not None

    assert captured["kwargs"] == {
        "service_name": "s3",
        "endpoint_url": ("https://account-123.r2.cloudflarestorage.com"),
        "aws_access_key_id": ("access-key"),
        "aws_secret_access_key": ("secret-key"),
        "region_name": "auto",
    }


def test_missing_configuration_fails_without_contacting_r2(
    monkeypatch,
):
    monkeypatch.setattr(
        settings,
        "r2_account_id",
        None,
    )

    monkeypatch.setattr(
        settings,
        "r2_access_key_id",
        None,
    )

    monkeypatch.setattr(
        settings,
        "r2_secret_access_key",
        None,
    )

    monkeypatch.setattr(
        settings,
        "r2_bucket_name",
        None,
    )

    with pytest.raises(
        R2ConfigurationError,
        match=("R2 write access is not configured"),
    ):
        R2Storage()


def test_upload_failure_returns_safe_application_error():
    class FailingClient(FakeR2Client):
        def put_object(
            self,
            **kwargs,
        ):
            raise ClientError(
                {
                    "Error": {
                        "Code": "500",
                        "Message": ("storage failed"),
                    }
                },
                "PutObject",
            )

    storage = R2Storage(
        client=FailingClient(),
        bucket_name="question-images",
    )

    with pytest.raises(
        R2StorageError,
        match=("Unable to upload question image"),
    ):
        storage.upload(
            key=("questions/version/image.png"),
            content=b"bytes",
            media_type="image/png",
        )


def test_delete_failure_returns_safe_application_error():
    class FailingClient(FakeR2Client):
        def delete_object(
            self,
            **kwargs,
        ):
            raise ClientError(
                {
                    "Error": {
                        "Code": "500",
                        "Message": ("storage failed"),
                    }
                },
                "DeleteObject",
            )

    storage = R2Storage(
        client=FailingClient(),
        bucket_name="question-images",
    )

    with pytest.raises(
        R2StorageError,
        match=("Unable to delete question image"),
    ):
        storage.delete(
            key=("questions/version/image.png"),
        )
