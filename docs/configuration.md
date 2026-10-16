# Configuration & Secrets

How the app gets its settings today: **local environment files only**. Nothing
is deployed yet, so there are no GitHub Actions secrets or variables and none
are required — CI authenticates with the automatic `GITHUB_TOKEN`.

## Quick start

```bash
cp .env.example .env        # root: backend + compose + shared values
cp frontend/.env.example frontend/.env.local   # frontend: public build-time values
```

Fill in real values in `.env`. Both `.env` and `frontend/.env.local` are
gitignored — **never commit them**.

## The variables

| Variable | Used by | Local value | Notes |
|---|---|---|---|
| `ENVIRONMENT` | backend | `local` | Free-form name: `local` / `ci` / `staging` / `production`. Has a default. |
| `BACKEND_CORS_ORIGINS` | backend | `http://localhost:3000` | Comma-separated browser origins allowed to call the API, e.g. `http://localhost:3000,http://127.0.0.1:3000`. Has a default (empty). |
| `POSTGRES_HOST` | backend | `127.0.0.1` | `127.0.0.1` on your machine; the compose service name `postgres` inside the compose network. Default: `127.0.0.1`. |
| `POSTGRES_PORT` | backend, compose | `5432` | Default: `5432`. |
| `POSTGRES_DB` | backend, compose | `jhep_db` | **Required** — no default. |
| `POSTGRES_USER` | backend, compose | `jhep` | **Required** — no default. |
| `POSTGRES_PASSWORD` | backend, compose | your local password | **Required** — no default. Keep the real value out of git. |
| `NEXT_PUBLIC_API_URL` | frontend | `http://localhost:8000/api/v1` | Base URL of the API as seen from the browser. Set in `frontend/.env.local`, not the root file — Next.js only loads env files from its own directory. |

Authentication settings (`JWT_SECRET_KEY`, `JWT_ALGORITHM`,
`ACCESS_TOKEN_EXPIRE_MINUTES`) are **commented out** in `.env.example` on
purpose. They become required when the auth ticket lands.

## Rules of thumb

- **`.env` never enters a Docker image.** The Dockerfiles deliberately copy
  only source code. Containers receive config at runtime via `compose.yaml`
  or `docker run --env-file .env`.
- **`POSTGRES_HOST` is per-environment.** Your machine: `127.0.0.1`. Inside the
  compose network: `postgres`. This is the classic "works locally, fails in a
  container" bug.
- **`NEXT_PUBLIC_*` is public and baked in at build time.** Any value is
  embedded in the JavaScript bundle and readable by anyone. Never put secrets
  there.
- **The backend fails fast on missing config.** Required settings have no
  default, so `Settings()` raises at import if `POSTGRES_DB/USER/PASSWORD`
  are unset — that's intentional.
- **Env vars win over the `.env` file.** pydantic-settings reads the process
  environment first, then `.env`.
- **Settings load from the repo root.** `config.py` resolves the `.env` file
  two directories up (`ROOT_DIR = parents[3]`), i.e. the repo root `.env` —
  not `backend/.env`.

## GitHub Actions (nothing needed yet)

- Secrets/variables belong in repository settings (or Environments with
  approval gates) the moment something deploys — never in workflow files.
- `NEXT_PUBLIC_*` values must be passed as **build args** to `next build`
  inside Docker/CI; they are not runtime variables.
- Forked pull requests do not receive repository secrets.

## When you add a new variable

1. Add it to `.env.example` with a placeholder and a comment saying who reads it.
2. Add it to `backend/app/core/config.py` (`Settings`) if the backend needs it.
3. Document it in the table above.
4. If it's a secret, give it **no default** so missing values fail loudly.
