# Configuration & Secrets

Job Hackers Exam configuration is environment-driven.

Local development uses the repository-root `.env` for FastAPI/backend settings. The Next.js frontend uses runtime environment variables and its same-origin `/api/v1/*` proxy.

Deployed services use Render environment variables. Secrets must never be committed to Git.

## Quick start

Backend/shared configuration:

```bash
cp .env.example .env
```

Frontend configuration:

```bash
cp frontend/.env.example frontend/.env.local
```

For the current local development stack:

```dotenv
BACKEND_PROXY_TARGET=http://127.0.0.1:8010
NEXT_PUBLIC_API_URL=
```

Leaving `NEXT_PUBLIC_API_URL` unset or empty makes the browser call the same-origin Next.js proxy:

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

Real credentials belong only in ignored local environment files or deployment-provider secret settings.

---

## Core variables

| Variable | Used by | Local/recommended value | Notes |
|---|---|---|---|
| `POSTGRES_DB` | backend, compose | `jhep_db` | Required. |
| `POSTGRES_USER` | backend, compose | `jhep` | Required. |
| `POSTGRES_PASSWORD` | backend, compose | local password | Required secret. Never commit. |
| `POSTGRES_HOST` | backend | `127.0.0.1` | Code default. Use `postgres` inside Compose. |
| `POSTGRES_PORT` | backend | `5432` | Code default. |
| `JWT_SECRET_KEY` | backend | long random value | Required secret. |
| `JWT_ALGORITHM` | backend | `HS256` | Current supported algorithm. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | backend | `30` | Generic access-token lifetime. |
| `LEARNER_ACCESS_TOKEN_HOURS` | backend | `12` | Learner-session lifetime. |
| `MAX_EXAM_QUESTIONS` | backend | `100` | Exam-size ceiling. |
| `CORS_ORIGINS` | backend | `http://localhost:3030` | Comma-separated direct-browser origins. |
| `FRONTEND_BASE_URL` | backend | `http://127.0.0.1:3030` | Browser redirect base for email verification and password reset. |
| `BACKEND_PROXY_TARGET` | frontend server | `http://127.0.0.1:8010` | Runtime target for the Next.js same-origin proxy. |
| `NEXT_PUBLIC_API_URL` | frontend/browser | empty | Optional public build-time override. Prefer the runtime proxy. |

### Frontend proxy configuration

The frontend requests API resources through:

```text
/api/v1/*
```

A Next.js catch-all route handler forwards those requests to FastAPI using `BACKEND_PROXY_TARGET`.

The target is read at request time, avoiding the build-time destination issues associated with Next.js configuration rewrites.

For local development:

```dotenv
BACKEND_PROXY_TARGET=http://127.0.0.1:8010
NEXT_PUBLIC_API_URL=
```

For Render:

```dotenv
BACKEND_PROXY_TARGET=https://jhep-backend.onrender.com
```

Do not append `/api/v1` to `BACKEND_PROXY_TARGET`; the proxy handler adds the API path.

`NEXT_PUBLIC_API_URL` should normally remain unset. An absolute `localhost` override breaks deployed frontends because visitors' browsers attempt to connect to their own computers.

### Frontend redirect configuration

`FRONTEND_BASE_URL` is configured on the backend.

It identifies where the browser should go after email verification or when using a password-reset link.

Example:

```dotenv
FRONTEND_BASE_URL=https://jhep-frontend.onrender.com
```

The local default is:

```text
http://127.0.0.1:3030
```

---

## Cloudflare R2 question media — JHEP-158 / JHEP-165

Question images are stored as objects in Cloudflare R2.

Public image delivery and storage write access are separate.

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

### R2 environment variables

| Variable | Used by | Example | Secret? | Notes |
|---|---|---|---|---|
| `MEDIA_BASE_URL` | backend | `https://pub-xxxxxxxx.r2.dev` | No | Public HTTPS delivery base. Do not include a trailing slash or object key. Production should prefer a Cloudflare custom domain. |
| `R2_ACCOUNT_ID` | backend | Cloudflare account ID | Private | Used to construct the R2 S3 API endpoint. |
| `R2_ACCESS_KEY_ID` | backend | generated access-key ID | Yes | Backend-only R2 credential. |
| `R2_SECRET_ACCESS_KEY` | backend | generated secret | Yes | Backend-only R2 credential. |
| `R2_BUCKET_NAME` | backend | `jhep-question-images-dev` | No | Question-image bucket. |
| `MAX_QUESTION_IMAGE_BYTES` | backend | `5242880` | No | Default maximum encoded upload size of 5 MiB. |
| `MAX_QUESTION_IMAGE_PIXELS` | backend | `20000000` | No | Default maximum decoded pixel count. |

Recommended local root `.env` configuration:

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

The R2 credentials should be scoped to the question-image bucket and only the permissions required by the backend.

### Read vs. write configuration

`MEDIA_BASE_URL` controls public image delivery.

R2 account, access-key, secret-key, and bucket settings control image upload, replacement, and removal.

R2 write credentials are optional at general application startup so read-only environments and tests can run without them.

An image-management request fails safely with HTTP `503` when R2 write access is unavailable.

### Image validation

Accepted formats:

```text
image/png
image/jpeg
image/webp
```

Validation inspects actual image bytes using Pillow rather than trusting only the filename or browser-provided MIME type.

Current defaults:

```text
Maximum encoded file size: 5 MiB
Maximum decoded pixels:    20,000,000
Maximum alt text:          1,000 characters
Images per version:        1
```

Invalid, corrupt, or unsupported images are rejected before being uploaded to Cloudflare R2.

### Object keys and version integrity

Conceptual storage-key format:

```text
questions/<question-version-id>/<generated-object-id>.<extension>
```

Replacing an image creates a new immutable storage key rather than overwriting the original object.

```text
Published question v1
        ↓
References original R2 image

Administrator edits media
        ↓
Creates pending/draft revision v2
        ↓
References new R2 image

Historical question v1
        ↓
Still references original image
```

Historical question versions retain their existing media references.

An old object is deleted only when no stored question-image row still references it.

### PostgreSQL media storage

PostgreSQL stores image metadata and storage references:

```text
storage_key
alt_text
media_type
position
```

PostgreSQL does not store image binaries.

`storage_key` remains backend-private. API responses expose a resolved public hosted `url` instead.

---

## Local development ports

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

Start the backend from the repository root:

```bash
cd backend
source .venv/bin/activate

uvicorn app.main:app \
  --reload \
  --host 0.0.0.0 \
  --port 8010
```

Start the frontend in another terminal:

```bash
cd frontend
npm run dev -- --port 3030
```

---

## Settings-file behavior

Backend settings load from the repository root:

```text
<repository>/.env
```

Not:

```text
backend/.env
```

`backend/app/core/config.py` resolves the repository root and configures `pydantic-settings` to read that file.

Process environment variables take precedence over values in `.env`.

Required database and JWT settings fail fast if missing.

---

## Rules of thumb

- `.env` and `frontend/.env.local` must never be committed.
- Never place backend credentials in `NEXT_PUBLIC_*`.
- `NEXT_PUBLIC_*` values are public and baked into frontend builds.
- Prefer `BACKEND_PROXY_TARGET` for Next.js-to-FastAPI communication.
- `BACKEND_PROXY_TARGET` is evaluated at request time.
- `NEXT_PUBLIC_API_URL` should normally remain unset.
- `POSTGRES_HOST` depends on where FastAPI runs:
  - Host machine: `127.0.0.1`
  - Compose network: `postgres`
- Required database and JWT settings fail fast when missing.
- R2 write credentials remain backend-only.
- `MEDIA_BASE_URL` is public configuration and must use HTTPS when set.
- Docker images must not contain `.env` files.
- Containers receive configuration through runtime environment variables or environment files.

---

## Render deployment

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

### Backend Render environment

Database settings are supplied through the Render database binding.

`JWT_SECRET_KEY` is generated by Render.

`FRONTEND_BASE_URL` should point to the deployed frontend.

`MEDIA_BASE_URL` can be supplied as non-secret public configuration.

JHEP-165 backend variables:

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

Configure `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` through Render environment/secret settings rather than committing actual credentials.

### Frontend Render environment

The Next.js frontend uses the same-origin runtime proxy.

Configure:

```dotenv
BACKEND_PROXY_TARGET=https://jhep-backend.onrender.com
```

Do not append `/api/v1`.

Leave `NEXT_PUBLIC_API_URL` unset unless an explicit absolute API override is required.

Without `BACKEND_PROXY_TARGET`, the proxy uses its local fallback of `http://127.0.0.1:8010`, which is unsuitable for separately deployed Render services.

---

## Email delivery — JHEP-24

Registration verification and password-reset delivery use environment configuration.

| Variable | Used by | Values / purpose |
|---|---|---|
| `EMAIL_DELIVERY` | backend | `console`, `mailpit`, `smtp`, `resend` |
| `EMAIL_FROM` | backend | Email sender address |
| `EMAIL_SMTP_HOST` | backend | SMTP hostname |
| `EMAIL_SMTP_PORT` | backend | SMTP port |
| `EMAIL_SMTP_USER` | backend | SMTP authentication |
| `EMAIL_SMTP_PASSWORD` | backend | SMTP credential |
| `EMAIL_SMTP_STARTTLS` | backend | STARTTLS toggle |
| `EMAIL_API_KEY` | backend | Resend API key |
| `VERIFICATION_LINK_BASE` | backend | Backend verification endpoint URL |
| `FRONTEND_BASE_URL` | backend | Frontend redirect origin |
| `VERIFY_TOKEN_TTL_HOURS` | backend | Verification-link lifetime; default 24 hours |
| `RESEND_INTERVAL_SECONDS` | backend | Verification resend throttle; default 60 seconds |
| `RESET_TOKEN_TTL_HOURS` | backend | Password-reset challenge lifetime; default 1 hour, allowed 1–24 |
| `RESET_MIN_INTERVAL_SECONDS` | backend | Forgot-password request throttle per account; default 60 seconds |

### Email delivery behavior

- `console` logs links for development and testing.
- `mailpit` captures email locally.
- `smtp` sends through a configured SMTP provider.
- `resend` sends using the Resend API.

Selecting a production email transport without its required credentials causes startup validation to fail rather than silently falling back.

Password-reset tokens have a shorter default lifetime than email-verification tokens.

For production, configure sender details, the email provider, and `FRONTEND_BASE_URL` before enabling real email delivery.

---

## GitHub Actions and secrets

Runtime secrets must not be committed to workflow files.

Use repository or environment secrets only when a workflow requires them.

`GITHUB_TOKEN` is supplied automatically for normal repository operations.

Forked pull requests do not receive repository secrets.

Cloudflare R2 credentials are not required by mocked/unit test suites because storage operations are isolated through the test configuration.

Public `NEXT_PUBLIC_*` values are build-time variables. Avoid unnecessary absolute API overrides by using the runtime proxy.

---

## Deployment tracking — JHEP-56

Render automatically deploys the `dev` branch outside GitHub.

The repository records deployment information through:

```text
.github/workflows/cd-deployment-status.yml
```

### GitHub deployment environments

| Environment | Trigger | Notes |
|---|---|---|
| `dev` | Push to `dev` affecting frontend/backend/deployment configuration | Tracks the Render frontend URL. Uses Jira's built-in development environment mapping. |
| `production` | Not configured | Reserved for an eventual production deployment from `main`. |

The GitHub deployment environment is:

```text
dev
```

Not:

```text
preview
```

The environment was renamed to `dev` to match Jira's built-in development-environment recognition.

No `.jira/config.yml` is required.

Jira associates deployments with issues using `JHEP-XXX` identifiers in commits and merge messages.

Jira recognizes deployment environment names such as:

```text
dev
development
test
staging
production
```

Earlier custom `preview` environment mappings and manually created deployment records may not display correctly in Jira's development panel.

---

## When adding a new environment variable

1. Add the variable to the appropriate `.env.example`.
2. Add backend settings to `backend/app/core/config.py` when required.
3. Document the variable in this file.
4. Keep secret credentials out of Git.
5. Configure deployment-provider environment variables separately.
6. Never expose server credentials through `NEXT_PUBLIC_*`.
7. Update relevant tests when the variable changes application behavior.