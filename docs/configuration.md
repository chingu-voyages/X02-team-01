# Configuration & Secrets

JHEP configuration is environment-driven.

Local development uses the repository-root `.env` for FastAPI/backend settings. The Next.js frontend uses runtime environment variables plus its same-origin `/api/v1/*` proxy.

The deployed Render services use Render environment variables. Secrets must never be committed to Git.

## Quick start

Backend/shared configuration:

```bash
cp .env.example .env
```

Frontend configuration:

```bash
cp frontend/.env.example frontend/.env.local
```

For the current local stack, the recommended frontend runtime configuration is:

```dotenv
BACKEND_PROXY_TARGET=http://127.0.0.1:8010
NEXT_PUBLIC_API_URL=
```

Leaving `NEXT_PUBLIC_API_URL` empty makes the browser call the same-origin Next.js proxy:

```text
browser
  ↓
http://localhost:3030/api/v1/*
  ↓
Next.js runtime proxy
  ↓
http://127.0.0.1:8010/api/v1/*
  ↓
FastAPI
```

Real values belong only in ignored local environment files or deployment-provider secret/environment configuration.

---

## Core variables

| Variable | Used by | Local/recommended value | Notes |
|---|---|---|---|
| `POSTGRES_DB` | backend, compose | `jhep_db` | Required. |
| `POSTGRES_USER` | backend, compose | `jhep` | Required. |
| `POSTGRES_PASSWORD` | backend, compose | local password | Required secret. Never commit the real value. |
| `POSTGRES_HOST` | backend | `127.0.0.1` | Code default. Use `postgres` when FastAPI runs inside Compose. |
| `POSTGRES_PORT` | backend | `5432` | Code default. |
| `JWT_SECRET_KEY` | backend | long random value | Required secret. |
| `JWT_ALGORITHM` | backend | `HS256` | Current supported algorithm. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | backend | `30` | Generic access-token lifetime. |
| `LEARNER_ACCESS_TOKEN_HOURS` | backend | `12` | Learner-session lifetime. |
| `MAX_EXAM_QUESTIONS` | backend | `100` | Exam-size ceiling. |
| `CORS_ORIGINS` | backend | `http://localhost:3030` | Comma-separated direct-browser origins. |
| `FRONTEND_BASE_URL` | backend | `http://127.0.0.1:3030` | Browser redirect base such as email verification. |
| `BACKEND_PROXY_TARGET` | frontend server | `http://127.0.0.1:8010` | Runtime target for the Next.js same-origin proxy. |
| `NEXT_PUBLIC_API_URL` | frontend/browser | empty | Optional build-time public override. Prefer the runtime proxy. |

---

## Cloudflare R2 question media — JHEP-158 / JHEP-165

Question images are stored as objects in Cloudflare R2.

Public delivery and write access are separate:

```text
Learner / Admin browser
        ↓
safe HTTPS image URL
        ↓
Cloudflare R2 public delivery

Contributor / Admin upload
        ↓
FastAPI
        ↓
backend-only R2 credentials
        ↓
Cloudflare R2 S3-compatible API
```

### R2 variables

| Variable | Used by | Example | Secret? | Notes |
|---|---|---|---|---|
| `MEDIA_BASE_URL` | backend | `https://pub-xxxxxxxx.r2.dev` | No | Public HTTPS delivery base. Do not include a trailing slash or object key. Production should prefer a Cloudflare custom domain. |
| `R2_ACCOUNT_ID` | backend | Cloudflare account ID | Private | Used to construct the R2 S3 API endpoint. |
| `R2_ACCESS_KEY_ID` | backend | generated access-key ID | Yes | Backend-only R2 credential. |
| `R2_SECRET_ACCESS_KEY` | backend | generated secret | Yes | Backend-only R2 credential. |
| `R2_BUCKET_NAME` | backend | `jhep-question-images-dev` | No | Question-image bucket. |
| `MAX_QUESTION_IMAGE_BYTES` | backend | `5242880` | No | Default maximum encoded upload size = 5 MiB. |
| `MAX_QUESTION_IMAGE_PIXELS` | backend | `20000000` | No | Default maximum decoded pixel count. |

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

Never commit the real values for:

```text
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

The R2 token should be scoped to the question-image bucket and only the permissions required by the backend.

### Read vs write configuration

`MEDIA_BASE_URL` controls public image delivery.

R2 write variables control upload/replace/remove operations.

R2 write credentials are optional at general application startup so read-only environments/tests can run without them. An image-management request fails safely with HTTP `503` when R2 write access is unavailable.

### Image validation

Accepted formats:

```text
image/png
image/jpeg
image/webp
```

Validation inspects actual bytes with Pillow rather than trusting only the filename/browser MIME type.

Current defaults:

```text
Maximum encoded file size: 5 MiB
Maximum decoded pixels:    20,000,000
Maximum alt text:          1,000 characters
Images per version:        1
```

Invalid/corrupt/unsupported files are rejected before R2 upload.

### Object keys and version integrity

Conceptual key format:

```text
questions/<question-version-id>/<generated-object-id>.<extension>
```

Replacing an image creates a **new immutable key** rather than overwriting the old object.

```text
Published v1
→ references old R2 object

Administrator changes media
→ v2 pending/draft
→ references new R2 object

Historical v1
→ continues referencing old object
```

An old object is deleted only when no stored question-image row still references it.

### PostgreSQL media storage

PostgreSQL stores metadata/reference information:

```text
storage_key
alt_text
media_type
position
```

PostgreSQL does not store image binaries.

`storage_key` remains backend-private; API responses expose a safe hosted `url`.

---

## Local ports

| Service | Address |
|---|---|
| Frontend | `http://localhost:3030` |
| Backend | `http://localhost:8010` |
| FastAPI docs | `http://localhost:8010/docs` |
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

## Settings-file behavior

Backend settings load:

```text
<repo>/.env
```

not:

```text
backend/.env
```

`config.py` resolves the repository root and configures `pydantic-settings` to read that file.

Process environment variables take precedence over `.env`.

---

## Rules of thumb

- `.env` and `frontend/.env.local` must never be committed.
- Never place backend secrets in `NEXT_PUBLIC_*`.
- `NEXT_PUBLIC_*` values are public/build-time baked.
- Prefer `BACKEND_PROXY_TARGET` for Next.js → FastAPI.
- `BACKEND_PROXY_TARGET` is read at request time.
- `NEXT_PUBLIC_API_URL` should normally remain empty.
- `POSTGRES_HOST` depends on where FastAPI runs:
  - host machine: `127.0.0.1`
  - Compose network: `postgres`
- Required DB/JWT configuration fails fast when missing.
- R2 write credentials are backend-only.
- `MEDIA_BASE_URL` is public configuration and must be HTTPS when set.

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

Database values are supplied from the Render database binding.

`JWT_SECRET_KEY` is generated by Render.

`MEDIA_BASE_URL` may be non-secret deployment configuration.

JHEP-165 backend values:

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
MAX_QUESTION_IMAGE_BYTES
MAX_QUESTION_IMAGE_PIXELS
```

Recommended non-secret values:

```text
R2_BUCKET_NAME=jhep-question-images-dev
MAX_QUESTION_IMAGE_BYTES=5242880
MAX_QUESTION_IMAGE_PIXELS=20000000
```

`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` should be configured in Render's environment/secret settings, never committed with real values.

### Frontend Render environment

The Next.js frontend uses the runtime same-origin proxy.

Set:

```text
BACKEND_PROXY_TARGET=<deployed backend origin>
```

Example:

```text
BACKEND_PROXY_TARGET=https://jhep-backend.onrender.com
```

Do not append `/api/v1`; the route handler adds it.

`NEXT_PUBLIC_API_URL` can remain unset/empty.

Without `BACKEND_PROXY_TARGET`, the proxy falls back to `http://127.0.0.1:8010`, which is useful locally but not valid for separate deployed services.

---

## Email delivery — JHEP-24

Registration verification uses environment configuration.

| Variable | Values / purpose |
|---|---|
| `EMAIL_DELIVERY` | `console`, `mailpit`, `smtp`, `resend` |
| `EMAIL_FROM` | From address |
| `EMAIL_SMTP_HOST` | SMTP host |
| `EMAIL_SMTP_PORT` | SMTP port |
| `EMAIL_SMTP_USER` | SMTP credential |
| `EMAIL_SMTP_PASSWORD` | SMTP credential |
| `EMAIL_SMTP_STARTTLS` | STARTTLS toggle |
| `EMAIL_API_KEY` | Resend API key |
| `VERIFICATION_LINK_BASE` | Backend verification URL |
| `FRONTEND_BASE_URL` | Frontend redirect origin |
| `VERIFY_TOKEN_TTL_HOURS` | Verification-link TTL |
| `RESEND_INTERVAL_SECONDS` | Resend throttle |

Selecting a production transport without its required credentials fails at startup rather than silently falling back.

---

## GitHub Actions and secrets

Runtime secrets do not belong in workflow files.

Use repository/environment secrets only when a workflow genuinely needs them.

`GITHUB_TOKEN` is supplied automatically for normal repository operations.

Forked pull requests do not receive repository secrets.

Cloudflare R2 credentials are not required by unit/mocked test suites because the storage adapter is dependency-injected/mocked.

---

## Deployment tracking — JHEP-56

Render auto-deploys `dev` outside GitHub. The repository records deployment status through:

```text
.github/workflows/cd-deployment-status.yml
```

Current GitHub environment:

```text
preview
```

Jira associates deployments through `JHEP-XXX` keys in commit/merge messages.

---

## When adding a new variable

1. Add it to the appropriate `.env.example`.
2. Add backend settings to `backend/app/core/config.py` when needed.
3. Document it here.
4. Keep secrets out of Git.
5. Add deployment-provider configuration separately.
6. Never expose server credentials through `NEXT_PUBLIC_*`.
