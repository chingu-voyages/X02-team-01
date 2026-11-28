# Configuration & Secrets

Job Hackers Exam configuration is environment-driven.

Local development uses the repository-root `.env` for FastAPI/backend settings. The Next.js frontend uses runtime environment variables and its same-origin `/api/v1/*` proxy.

Deployed services use Render environment variables. Secrets must never be committed to Git.

---

## Quick start

Backend/shared configuration:

```bash
cp .env.example .env
```

Frontend configuration:

```bash
cp frontend/.env.example frontend/.env.local
```

Current local development defaults:

```dotenv
BACKEND_PROXY_TARGET=http://127.0.0.1:8010
NEXT_PUBLIC_API_URL=
```

Leaving `NEXT_PUBLIC_API_URL` unset or empty makes the browser use the same-origin Next.js proxy:

```text
Browser
  ↓
http://localhost:3030/api/v1/*
  ↓
Next.js runtime proxy
  ↓
http://127.0.0.1:8010/api/v1/*
  ↓
FastAPI
```

The proxy reads `BACKEND_PROXY_TARGET` at request time. It does not require rebuilding the frontend when the target changes.

---

# Core variables

| Variable | Used by | Local/recommended value | Notes |
|---|---|---|---|
| `POSTGRES_DB` | backend, compose | `jhep_db` | Required. |
| `POSTGRES_USER` | backend, compose | `jhep` | Required. |
| `POSTGRES_PASSWORD` | backend, compose | local password | Required secret. Never commit. |
| `POSTGRES_HOST` | backend | `127.0.0.1` | Use `postgres` inside Compose. |
| `POSTGRES_PORT` | backend | `5432` | Code default. |
| `JWT_SECRET_KEY` | backend | long random value | Required secret. |
| `JWT_ALGORITHM` | backend | `HS256` | Current supported algorithm. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | backend | `30` | Generic access-token lifetime. |
| `LEARNER_ACCESS_TOKEN_HOURS` | backend | `12` | Learner-session lifetime. |
| `MAX_EXAM_QUESTIONS` | backend | `100` | Exam-size ceiling. |
| `CORS_ORIGINS` | backend | `http://localhost:3030` | Comma-separated direct-browser origins. |
| `FRONTEND_BASE_URL` | backend | `http://127.0.0.1:3030` | Redirect base for verification/reset flows. |
| `BACKEND_PROXY_TARGET` | frontend server | `http://127.0.0.1:8010` | Runtime FastAPI target. |
| `NEXT_PUBLIC_API_URL` | frontend/browser | empty | Optional public build-time override; normally leave empty. |

---

# Frontend proxy configuration

The frontend requests API resources through:

```text
/api/v1/*
```

A Next.js catch-all route forwards those requests using `BACKEND_PROXY_TARGET`.

Local:

```dotenv
BACKEND_PROXY_TARGET=http://127.0.0.1:8010
NEXT_PUBLIC_API_URL=
```

Render:

```dotenv
BACKEND_PROXY_TARGET=https://jhep-backend.onrender.com
```

Do not append `/api/v1` to `BACKEND_PROXY_TARGET`.

`NEXT_PUBLIC_API_URL` should normally remain unset. An absolute `localhost` override breaks deployed frontends because visitors' browsers would attempt to connect to their own computers.

---

# Frontend redirect configuration

`FRONTEND_BASE_URL` is configured on the backend.

Example production value:

```dotenv
FRONTEND_BASE_URL=https://jhep-frontend.onrender.com
```

Local default:

```text
http://127.0.0.1:3030
```

It is used for email-verification and password-reset browser redirects.

---

# Cloudflare R2 question media — JHEP-158 / JHEP-165 / JHEP-118

Question images are stored as objects in Cloudflare R2.

Public image delivery and storage write access are separate:

```text
Learner / Admin browser
        ↓
Safe HTTPS image URL
        ↓
Cloudflare R2 public delivery

Contributor / Admin upload
        ↓
FastAPI
        ↓
Backend-only R2 credentials
        ↓
Cloudflare R2 S3-compatible API
```

## R2 environment variables

| Variable | Used by | Example | Secret? | Notes |
|---|---|---|---|---|
| `MEDIA_BASE_URL` | backend | `https://pub-xxxxxxxx.r2.dev` | No | Public HTTPS delivery base. |
| `R2_ACCOUNT_ID` | backend | Cloudflare account ID | Private | Used to construct the R2 S3 API endpoint. |
| `R2_ACCESS_KEY_ID` | backend | generated access-key ID | Yes | Backend-only credential. |
| `R2_SECRET_ACCESS_KEY` | backend | generated secret | Yes | Backend-only credential. |
| `R2_BUCKET_NAME` | backend | `jhep-question-images-dev` | No | Question-image/import-asset bucket. |
| `MAX_QUESTION_IMAGE_BYTES` | backend | `5242880` | No | Default max encoded image upload size, 5 MiB. |
| `MAX_QUESTION_IMAGE_PIXELS` | backend | `20000000` | No | Default max decoded pixel count. |

Recommended local root `.env`:

```dotenv
MEDIA_BASE_URL=https://pub-xxxxxxxx.r2.dev

R2_ACCOUNT_ID=<cloudflare-account-id>
R2_ACCESS_KEY_ID=<r2-access-key-id>
R2_SECRET_ACCESS_KEY=<r2-secret-access-key>
R2_BUCKET_NAME=jhep-question-images-dev

MAX_QUESTION_IMAGE_BYTES=5242880
MAX_QUESTION_IMAGE_PIXELS=20000000
```

Never commit actual R2 access keys or secret access keys.

The R2 credentials should be scoped to the question-image bucket and only the permissions the backend requires.

## Read vs. write configuration

`MEDIA_BASE_URL` controls public image delivery.

The R2 account/access/secret/bucket values control upload, replacement, removal, and JHEP-118 staged import assets.

R2 write credentials are optional at general application startup so read-only environments and unit tests can run without them.

Image-management or import-asset requests fail safely with HTTP `503` when write access is unavailable.

## Image validation

Accepted formats:

```text
image/png
image/jpeg
image/webp
```

Validation inspects actual image bytes using Pillow rather than trusting only the filename or browser MIME type.

Current defaults:

```text
Maximum encoded file size: 5 MiB
Maximum decoded pixels:    20,000,000
Maximum alt text:          1,000 characters
Images per version:        1
```

Invalid, corrupt, unsupported, or unsafe-dimension images are rejected before they become question media.

---

# JHEP-118 bulk-import storage behavior

JHEP-118 does **not** introduce new environment variables.

It reuses:

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
MAX_QUESTION_IMAGE_BYTES
MAX_QUESTION_IMAGE_PIXELS
```

The Excel workbook itself is parsed by FastAPI and is not stored as an R2 object by the current implementation.

Referenced image files are staged as immutable R2 objects under conceptual internal keys:

```text
imports/<batch-id>/<asset-id>.<extension>
```

Those raw keys remain backend-private.

Workflow:

```text
Upload XLSX
   ↓
Rows staged in PostgreSQL
   ↓
Workbook references image filename
   ↓
Contributor/Admin uploads image
   ↓
Image byte/dimension validation
   ↓
Temporary import object in R2
   ↓
Batch revalidation
   ↓
Atomic commit
   ↓
QuestionImage references the validated immutable object
```

A staged asset can be reused by more than one imported question row.

Question-import asset upload is the only part of the import workflow that requires R2 write configuration. A workbook containing no image references can validate and commit without an import-asset upload.

Current hard-coded contract limits:

```text
Workbook authoring format: .xlsx
Maximum workbook size:     5 MiB
Maximum question rows:     1,000
Import preview page max:   100
Import history page max:   100
```

These are implementation limits, not environment variables in the current version.

---

# Question media object keys and version integrity

Normal question-image object keys are conceptually:

```text
questions/<question-version-id>/<generated-object-id>.<extension>
```

Replacement creates a new immutable object key rather than overwriting the original object.

Historical versions retain their prior media references.

An object is deleted only when no stored question-image row still references it.

PostgreSQL stores:

```text
storage_key
alt_text
media_type
position
```

PostgreSQL does not store image binaries.

API responses expose a resolved hosted `url`, not the private `storage_key`.

---

# Local development ports

| Service | Address |
|---|---|
| Frontend | `http://localhost:3030` |
| Backend | `http://localhost:8010` |
| FastAPI documentation | `http://localhost:8010/docs` |
| PostgreSQL | `127.0.0.1:5432` |

Start PostgreSQL:

```bash
sudo docker compose up -d postgres
```

Start backend:

```bash
cd backend
source .venv/bin/activate

uvicorn app.main:app \
  --reload \
  --host 0.0.0.0 \
  --port 8010
```

Start frontend:

```bash
cd frontend
npm run dev -- --port 3030
```

---

# Local demo accounts / content

Verified local administrator:

```bash
cd backend
source .venv/bin/activate
python -m scripts.seed_demo_admin --confirm-local
```

Current demo admin credentials are printed by the script. It refreshes the local demo password and preserves MFA fields. An unenrolled administrator can only complete Account Security setup until MFA is confirmed and a fresh sign-in succeeds. Configure a local `MFA_ENCRYPTION_KEY` first; preserve the existing key if accounts are already enrolled.

To create missing local team administrator accounts instead, use `python -m scripts.seed_local_admins --confirm-local` from `backend/`. This prompts for a password and preserves matching existing accounts. See [Administrator security and onboarding](administrator-security.md#5-local-development-only).

Seed the local demo learner/certification content:

```bash
python -m scripts.seed_demo_exams --confirm-local
```

The demo learner can be promoted to Contributor through the Administrator Users & Access screen for role-boundary/manual JHEP-118 testing.

All seed scripts include local-database safety checks and must never be run against production.

---

# JHEP-118 frontend template

The current import page serves the approved workbook from:

```text
frontend/public/templates/question-bank-import-template-v2.xlsx
```

The browser route is:

```text
/admin/questions/import
```

The frontend talks to FastAPI through the same `/api/v1/*` proxy as the rest of the application.

No import-specific frontend secret is required.

---

# Settings-file behavior

Backend settings load from the repository root:

```text
<repository>/.env
```

not:

```text
backend/.env
```

`backend/app/core/config.py` resolves the repository root and configures `pydantic-settings` to read that file.

Process environment variables take precedence over `.env`.

Required database/JWT settings fail fast when missing.

---

# Rules of thumb

- `.env` and `frontend/.env.local` must never be committed.
- Never place backend credentials in `NEXT_PUBLIC_*`.
- `NEXT_PUBLIC_*` values are public and baked into frontend builds.
- Prefer `BACKEND_PROXY_TARGET` for Next.js-to-FastAPI communication.
- `BACKEND_PROXY_TARGET` is evaluated at request time.
- `NEXT_PUBLIC_API_URL` should normally remain unset.
- Host-machine PostgreSQL uses `127.0.0.1`; Compose-network FastAPI uses `postgres`.
- R2 write credentials remain backend-only.
- `MEDIA_BASE_URL` is public configuration and must use HTTPS when set.
- Question-import responses must never expose raw R2 keys.
- Docker images must not contain `.env` files.
- Containers receive configuration through runtime environment variables or env files.

---

# Render deployment

Services are defined in:

```text
render.yaml
```

Current services:

```text
jhep-backend
jhep-frontend
jhep-db
```

## Backend Render environment

Database settings are supplied through the Render database binding.

`JWT_SECRET_KEY` is generated/configured by Render.

`MFA_ENCRYPTION_KEY` must be configured as a stable backend secret before
releasing mandatory administrator MFA. It is not declared in the reviewed
`render.yaml`; verify the dashboard/environment configuration. Never replace
an existing working key during routine deployment. Verify at least one
authorized administrator can sign in with MFA, and verify the deployed email
transport and verification/reset link targets before release.

`FRONTEND_BASE_URL` should point to the deployed frontend.

`MEDIA_BASE_URL` can be non-secret public configuration.

R2 variables:

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
MAX_QUESTION_IMAGE_BYTES
MAX_QUESTION_IMAGE_PIXELS
```

Recommended non-secret values:

```dotenv
R2_BUCKET_NAME=jhep-question-images-dev
MAX_QUESTION_IMAGE_BYTES=5242880
MAX_QUESTION_IMAGE_PIXELS=20000000
```

Configure account/access/secret values through Render environment/secret settings.

If image-backed imports are expected in deployed environments, the backend service needs the same valid R2 write configuration used by ordinary question-image management.

## Frontend Render environment

Configure:

```dotenv
BACKEND_PROXY_TARGET=https://jhep-backend.onrender.com
```

Do not append `/api/v1`.

Leave `NEXT_PUBLIC_API_URL` unset unless an explicit absolute public API override is required.

---

# Email delivery — JHEP-24 / JHEP-124

Registration verification and password-reset delivery use environment configuration.

| Variable | Purpose |
|---|---|
| `EMAIL_DELIVERY` | `console`, `mailpit`, `smtp`, or `resend` |
| `EMAIL_FROM` | sender address |
| `EMAIL_SMTP_HOST` | SMTP host |
| `EMAIL_SMTP_PORT` | SMTP port |
| `EMAIL_SMTP_USER` | SMTP user |
| `EMAIL_SMTP_PASSWORD` | SMTP secret |
| `EMAIL_SMTP_STARTTLS` | STARTTLS toggle |
| `EMAIL_API_KEY` | Resend API key |
| `VERIFICATION_LINK_BASE` | verification endpoint base |
| `FRONTEND_BASE_URL` | frontend redirect origin |
| `VERIFY_TOKEN_TTL_HOURS` | verification lifetime; default 24h |
| `RESEND_INTERVAL_SECONDS` | verification resend throttle; default 60s |
| `RESET_TOKEN_TTL_HOURS` | password reset lifetime; default 1h |
| `RESET_MIN_INTERVAL_SECONDS` | forgot-password throttle; default 60s |

Production transports fail startup validation when required credentials are absent rather than silently falling back.

---


# Multi-factor authentication — JHEP-109 / JHEP-207

Administrator MFA is mandatory. The application can start without
`MFA_ENCRYPTION_KEY`, but MFA setup returns `503 MFA_NOT_CONFIGURED`,
administrator promotion requires configured and usable MFA, and already
enrolled accounts still require their second factor at login. A missing
key is not an administrator-access bypass.

| Variable | Purpose |
|---|---|
| `MFA_ENCRYPTION_KEY` | Stable backend-only secret used to encrypt TOTP secrets at rest. For a fresh environment only, generate with `python -c "import secrets; print(secrets.token_urlsafe(32))"`. |
| `MFA_CHALLENGE_MINUTES` | Sign-in challenge lifetime, default 5 minutes. |
| `MFA_MAX_ATTEMPTS` | Failed codes permitted before a challenge locks, default 5. |
| `MFA_RECOVERY_CODE_COUNT` | Single-use recovery codes issued at enrollment, default 8. |
| `LEARNER_ACCESS_TOKEN_HOURS` | Full login session lifetime for all roles, default 12 hours. |

The 15-minute administrator enrollment-only token and 300-second
administrator promotion freshness window are fixed by the implementation;
they are not additional environment switches.

Role policy:

- Administrators must enroll and sign in with MFA before administrative access.
- Contributors may enroll; confirmed enrollment then requires MFA at login.
- Learners cannot begin new enrollment; existing enrollment survives role changes.

Enrollment is available through `/account/security`. After confirmation,
save the one-time recovery codes and sign in again. Confirmed enrollment
cannot be overwritten via setup. Password resets do not disable MFA.

Keep the existing encryption key stable across redeploys and replicas of the
same environment; losing or replacing it can render stored secrets unusable.
Use independent keys for independent environments and never share the
database with a different key. No automatic key rotation or self-service
authenticator reset is implemented. Store a protected recovery backup of the
key. Never expose it to the frontend or commit it.

See [Administrator security and onboarding](administrator-security.md) for
production preflight, local account setup, promotion, and recovery limits.

---

# GitHub Actions and secrets

Runtime secrets must not be committed to workflow files.

Use repository/environment secrets only where a workflow requires them.

`GITHUB_TOKEN` is supplied automatically for normal repository operations.

Forked pull requests do not receive repository secrets.

R2 credentials are not required by mocked/unit test suites because storage operations are isolated behind test doubles.

---

# Deployment tracking — JHEP-56

Render automatically deploys the `dev` branch outside GitHub.

The repository records deployment status through:

```text
.github/workflows/cd-deployment-status.yml
```

GitHub deployment environment:

```text
dev
```

The environment name is intentionally compatible with Jira's development-environment recognition.

Jira associates deployments with issues by `JHEP-XXX` identifiers in commit/merge messages.

---

# When adding a new environment variable

1. Add it to the appropriate `.env.example`.
2. Add backend settings to `backend/app/core/config.py` when needed.
3. Document it here.
4. Keep secret credentials out of Git.
5. Configure deployment-provider values separately.
6. Never expose server credentials through `NEXT_PUBLIC_*`.
7. Update tests when the variable changes application behavior.
