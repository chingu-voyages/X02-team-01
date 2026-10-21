import os

# Required settings have no defaults, so supply safe test values before the
# application (and its Settings object) is imported.
os.environ.setdefault("POSTGRES_DB", "test_db")
os.environ.setdefault("POSTGRES_USER", "test_user")
os.environ.setdefault("POSTGRES_PASSWORD", "test_password")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-that-is-at-least-32-bytes")
