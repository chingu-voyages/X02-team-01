"""Test accounts for domain APIs and real administrator sign-in journeys.

Domain tests model an already authenticated account, as they did before MFA,
using the real signed-token and database-backed authorization checks. Only
explicit test data is provisioned here; no security dependency is overridden.
The login journeys use the actual MFA endpoints instead of synthetic tokens.
"""

import base64
import hashlib
from datetime import UTC, datetime
from functools import lru_cache

import pyotp
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app.core.roles import UserRole
from app.core.security import create_access_token_for_learner, hash_password
from app.models import User

# Fixture-only values. Never use these for real accounts or deployments.
TEST_MFA_KEY = "jhep207-isolated-test-encryption-key"
_TEST_PASSWORD = "DomainFixture1!"


@lru_cache(maxsize=1)
def _domain_password_hash() -> str:
    return hash_password(_TEST_PASSWORD)


def make_domain_user(**fields) -> User:
    """Construct an account for non-login tests with explicit MFA state.

    Admin fixtures model confirmed enrollment. Other roles keep their original
    fields. A caller must persist the returned row in its isolated test DB.
    """
    user = User(**fields)
    if user.role == UserRole.ADMINISTRATOR.value:
        enrolled_at = datetime.now(UTC)
        key = base64.urlsafe_b64encode(hashlib.sha256(TEST_MFA_KEY.encode()).digest())
        secret = pyotp.random_base32()
        user.is_verified = True
        user.hashed_password = user.hashed_password or _domain_password_hash()
        user.totp_secret_encrypted = Fernet(key).encrypt(secret.encode()).decode()
        user.mfa_enrolled_at = enrolled_at
        user.sessions_invalid_before = enrolled_at
    return user


def domain_access_token(user: User) -> str:
    """Sign a synthetic post-authentication token, without mutating the user.

    Deliberately never bypass an administrator's missing enrollment. Tests of
    invalid or incomplete authentication must issue their own negative tokens.
    """
    if user.role == UserRole.ADMINISTRATOR.value and user.mfa_enrolled_at is None:
        raise AssertionError("Administrator domain fixture must be MFA-enrolled")
    verified = datetime.now(UTC) if user.mfa_enrolled_at is not None else None
    return create_access_token_for_learner(
        user, authenticated_at=verified, mfa_verified_at=verified
    )


def sign_in_administrator(client: TestClient, email: str, password: str) -> dict:
    """Complete actual enrollment and fresh MFA login for a new test admin.

    Requires a fresh unenrolled account, the real auth endpoints, a test MFA
    key and persisted MFA challenge/recovery-code tables in the test database.
    Never call this helper on real accounts.
    """
    auth = "/api/v1/auth"
    credentials = {"email": email, "password": password}
    login = client.post(f"{auth}/login", json=credentials)
    assert login.status_code == 200
    restricted = login.json()
    assert restricted["learner"]["role"] == "administrator"
    assert restricted["mfa_enrollment_required"] is True
    headers = {"Authorization": f"Bearer {restricted['access_token']}"}

    setup = client.post(f"{auth}/mfa/enroll/setup", headers=headers)
    assert setup.status_code == 200
    authenticator = pyotp.TOTP(setup.json()["secret"])
    confirmed = client.post(
        f"{auth}/mfa/enroll/verify", headers=headers, json={"code": authenticator.now()}
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["recovery_codes"]

    login = client.post(f"{auth}/login", json=credentials)
    assert login.status_code == 200
    challenge = login.json()
    assert challenge["mfa_required"] is True
    assert challenge["mfa_enrollment_required"] is False
    completed = client.post(
        f"{auth}/mfa/verify",
        headers={"Authorization": f"Bearer {challenge['access_token']}"},
        json={"code": authenticator.now()},
    )
    assert completed.status_code == 200
    result = completed.json()
    assert result["learner"]["role"] == "administrator"
    assert result["mfa_required"] is False
    assert result["mfa_enrollment_required"] is False
    return result
