"""Configure test defaults before application settings are imported."""

import os

# Fast tests do not require a live database.
# Integration tests must use explicitly configured database credentials
# from the environment or the repository-root .env file instead.
if os.getenv("RUN_DB_INTEGRATION") != "1":
    os.environ.setdefault("POSTGRES_DB", "test_db")
    os.environ.setdefault("POSTGRES_USER", "test_user")
    os.environ.setdefault("POSTGRES_PASSWORD", "test_password")

# Keep a test-only fallback for tests that create and verify JWTs.
os.environ.setdefault(
    "JWT_SECRET_KEY",
    "test-secret-key-that-is-at-least-32-bytes",
)
