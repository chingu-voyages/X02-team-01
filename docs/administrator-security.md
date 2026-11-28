# Administrator security and onboarding

**Scope:** JHEP-109, JHEP-124, JHEP-125, JHEP-192 and JHEP-207. Reviewed against `a727cd045112a77f0e25a1426fbcc1bd470392fc` (27 November 2026). This guide describes the implemented application, not confirmation of a deployed environment's configuration.

## 1. Policy at a glance

| Account | MFA policy | Access |
|---|---|---|
| Learner | No new enrollment offered | Practice exams and own attempts |
| Contributor | Optional enrollment; required at subsequent sign-in once confirmed | Own question drafts, imports, and explicitly granted grading permissions |
| Administrator | Enrollment and full MFA sign-in required | Administrative features, including user management |

MFA remains required after a role change if enrollment is already confirmed. A password reset never disables MFA. Existing unenrolled administrators receive an enrollment-only session, not normal administrator access. All learner content routes and administrative routes check the current account and session revocation cutoff in the database.

## 2. Onboard a new administrator

Use the ordinary registration and promotion flow when an authorized administrator already exists. The new account owner chooses and retains control of their own password and authenticator.

1. The new user registers through `/register`, follows the email verification link, and signs in as a Learner.
2. An existing administrator opens **Users & Access** (`/admin/users`), searches for the user's exact email, chooses **Make Contributor**, and confirms.
3. The user signs in again if necessary to refresh the role displayed by the browser. Open **Account Security** (`/account/security`), choose **Set up two-factor authentication**, scan the QR code or enter the private key in their authenticator, and enter its current six-digit code.
4. The user saves the recovery codes privately, acknowledges receipt, and signs in again with their password and MFA. Enrollment invalidates the previous session.
5. The acting administrator signs in with their own password and MFA. Both authentication timestamps must be no more than five minutes old when the promotion is submitted.
6. In Users & Access, find the Contributor and choose **Grant Administrator access**. The read-only eligibility check explains missing requirements. A Contributor must have verified email, a password, and usable confirmed MFA enrollment. Only the current account data is authoritative.
7. Enter a business reason (1–1,000 characters after trimming), type the target email, acknowledge full administrator privileges, and choose **Confirm Administrator promotion**. The server compares the trimmed email case-insensitively. Never enter passwords, MFA secrets or recovery codes in the reason field.
8. The role, session revocation cutoff and role-change audit record are committed together. The recipient's previous sessions and pending sign-in challenges are no longer valid. The recipient signs in again with MFA; the new session carries the Administrator role.

If eligibility changes or the request outcome is uncertain, refresh the account and eligibility before confirming again. If the recent-authentication window expires, use **Sign in again**, return to Users & Access, and select the account again. The preview does not reserve eligibility or extend the authorization window.

The ordinary role endpoint accepts only `learner` and `contributor`. Administrator promotion is separate, cannot target oneself or an existing administrator, and does not allow administrator demotion. No shared-password invitation or administrator-managed password creation workflow is implemented. A production deployment with no working administrator requires a separately authorized operator bootstrap or recovery procedure; do not use the local demo scripts or disable MFA in production.

## 3. First sign-in for an existing unenrolled administrator

After verifying the password, the server returns `mfa_enrollment_required: true` and a 15-minute enrollment-only token. The frontend takes the user to Account Security and hides administrator navigation. Only MFA status, setup and enrollment confirmation are permitted with that token. Administrator requests are blocked with 403; learner content requests with that restricted token are blocked with 401.

Complete enrollment, privately save the one-time recovery codes, and select **Sign in again**. The enrollment token cannot become a full session. An enrolled account signs in using its password followed by the authenticator or one unused recovery code. The challenge token is not a normal access token.

## 4. Deployment checklist (before merging/releasing)

- Verify the backend's `MFA_ENCRYPTION_KEY` is present, strong, and stable for the database it serves. Generate a new value only for a fresh deployment without existing enrollments. Keep a protected backup of the existing key separately from database backups. All backend replicas serving the same database need the same key. Replacing the key without a migration makes existing encrypted TOTP secrets unreadable; no key-rotation procedure is implemented by this change.
- Keep `JWT_SECRET_KEY`, `MFA_ENCRYPTION_KEY`, email transport credentials and database credentials in backend-only secret storage. Never expose them through `NEXT_PUBLIC_*`, commit them or paste them in logs, screenshots or Jira.
- Verify production email delivery and the verification/reset link destinations. Account owners must be able to verify their email and reset their own passwords. Do not use console-only delivery for public production onboarding.
- Verify HTTPS, backend proxy routing and database migrations for the existing MFA, session cutoff and audit fields. See [configuration](configuration.md) for variables. This checkpoint introduces no new migration.
- Check that at least one authorized existing administrator can complete enrollment or sign in with MFA; operationally, maintain a second independently secured administrator. Confirm each stores their own recovery codes securely. Do not use shared accounts.
- Verify a Contributor without MFA cannot be promoted, that a valid promotion produces one role audit row, and that the recipient's old session returns 401 on both administrator and learner content endpoints.
- Verify a fresh MFA session can access Users & Access and the learner catalog. Check email verification, password reset, MFA recovery, and normal learner sign-in in the deployment environment before production release.

`render.yaml` does not declare `MFA_ENCRYPTION_KEY` at the reviewed baseline. Set/check the existing secret in the backend service's environment settings (Render or the equivalent hosting platform); the repository alone does not establish whether a deployed key is present. A healthy `/health` response is not proof of working MFA. Startup allows a missing MFA key, but administrator enrollment and promotion cannot proceed normally without it.

## 5. Local development only

Use a disposable local PostgreSQL database. Configure the repository-root `.env` with database settings, JWT secret and a local `MFA_ENCRYPTION_KEY`. To generate a value for a new local environment only:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Store the result in `.env` privately; do not regenerate an existing working key. Start services using [configuration.md](configuration.md). From `backend/` with the virtual environment active:

```bash
python -m scripts.seed_local_admins --confirm-local
```

This creates missing `admin1@jobhackers.test` through `admin6@jobhackers.test` accounts and prompts for a local password. It preserves matching existing accounts and MFA settings; conflicts are refused. The new accounts are verified but unenrolled. They must complete the same mandatory enrollment and fresh sign-in as any other administrator.

Alternatively, `python -m scripts.seed_demo_admin --confirm-local` creates or refreshes the deterministic demo administrator and prints its demo credentials. It resets that demo account's password to the fixture value, so use it only for disposable testing. The browser suite uses local test seeders with safety checks; it must not be pointed at production. Never use test fixture credentials or test MFA keys outside the test database.

## 6. Recovery and incident handling

| Situation | Supported action |
|---|---|
| Forgot password | Use the normal password-reset flow. Existing sessions and older MFA challenges are invalidated; MFA is still required. |
| Lost authenticator, recovery codes available | Sign in with password, then use an unused recovery code at the MFA challenge. Each code is single-use. |
| Lost authenticator and all recovery codes | Escalate to the authorized platform operator for identity-verified recovery. No self-service MFA reset, replacement, or recovery-code regeneration is implemented. |
| MFA setup says already enrolled | Do not restart setup or clear the stored secret. Use the existing authenticator or recovery code. |
| Missing or invalid deployment encryption key | Check secret configuration and restore the correct existing key through authorized operations. Do not overwrite enrollments or issue a new key as an automatic fix. |
| Promotion says fresh authentication required | Sign in again with password and MFA; reopen the target account and reconfirm. |
| Promotion request times out or response is lost | Refresh Users & Access and the eligibility preview before trying again. Never assume the first operation failed. |
| Account suspected compromised | Escalate promptly. A successful password reset invalidates old sessions but does not replace compromised MFA. Existing administrator demotion and full incident recovery are outside this UI. |

An ordinary logout discards the browser session token and is stateless; it is not a server-side global revocation. Do not rely on logout alone to invalidate copied credentials. Protected requests reject sessions older than `sessions_invalid_before` after successful password reset, confirmed MFA enrollment, or administrator promotion. An already-started request is not automatically cancelled by a subsequent revocation.

## 7. Audit, test evidence and limitations

Successful administrator promotion stores a `role_change_audit` record containing the actor ID, target ID, `promoted` action, previous `contributor` role, new `administrator` role, reason and timestamp. The API returns `audit_id`. This is not a complete centralized security-event pipeline; unsuccessful attempts are not represented by a successful role-change record. Ordinary Contributor role changes and grading-permission updates have their own audit behavior. The UI does not provide an administrator demotion or self-service MFA replacement flow.

The strict fixture migration removes the old `legacy_unenrolled_admin_fixture` exception. Ordinary domain tests use persisted accounts and signed simulated post-authentication sessions; dedicated security tests and login journeys use the actual MFA endpoints. Do not mistake simulated fixture sessions for real enrollment tests.

Local verification reported during JHEP-207: 881 backend tests passed with `RUN_DB_INTEGRATION=1`, no failures or skips, and Ruff lint/format passed (42 non-blocking warnings). Administrator enrollment and promotion browser journeys passed in their respective checkpoints. These are local test results, not proof of deployment readiness or exhaustive PostgreSQL concurrency testing.

Run the security and complete regression suites against the disposable local environment:

```bash
# backend/ with .venv active
python -m pytest tests/test_mfa_api.py tests/test_mfa_hardening_api.py \
  tests/test_admin_mfa_enrollment_api.py tests/test_admin_promotion_api.py \
  tests/test_learner_session_revocation_api.py -q
RUN_DB_INTEGRATION=1 python -m pytest -q
python -m ruff check .
python -m ruff format --check .
```

```bash
# frontend/
npm test -- --run
npx tsc --noEmit
npm run lint
npm run build
npx playwright test e2e/admin-mfa-enrollment.e2e.ts \
  e2e/admin-promotion.e2e.ts --project=chromium --workers=1
```

See the [API contract](CONTRACT_API_JSON.md#11-admin-users--access--current) for request/response formats and error codes. Final full-browser regression, manual responsive/accessibility inspection and deployment verification remain release gates. Review Answers is intentionally deferred pending its design decision.
