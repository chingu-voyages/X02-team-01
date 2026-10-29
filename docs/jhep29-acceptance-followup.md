# ✅ JHEP-29 — Acceptance Criteria Follow-up

> **Baseline:** PR #14 already merged into `dev`. These are follow-up changes, not a rewrite.  
> **Depends on:** JHEP-57 (actual asset uploads/hosting), JHEP-58 (content limits), JHEP-32 (saving answers).

## 📌 What's included

| Criterion | Backend implementation | Remaining integration |
|---|---|---|
| 🔀 AC1 | Approved/active/unflagged random selection, same-certification scope, unique assignments | None |
| 📏 AC2 | Strict 1–100 input count, `MAX_EXAM_QUESTIONS` deployment ceiling (1–100), safe insufficient pool | Confirm product configuration |
| 🖼️ AC3 | Version-linked image metadata and batched delivery; URL/alt-text fallback; unchanged UTF-8/LaTeX text | Uploads and public HTTPS CDN; frontend math/image rendering |
| 🌍 AC4 | PostgreSQL `TEXT` preserves Unicode, math, long content | Agreed maximum length |
| 💾 AC5 | Attempt/version/position pinned; authenticated ownership-checked `GET /api/v1/exams/{attempt_id}` | Saves selected answers and navigation position |
| 🛡️ AC6 | Validation, malformed multiple-choice filtering, no partial attempts, sanitized API errors | Media rendering fallback on broken remote URLs |
| ⚡ AC7 | Batched options and image retrieval (3 SELECTs), tests for security and data integrity | Frontend tests with real media; optional load testing |

## 🧱 Migration

Introduces `question_images`, linked to `question_versions`, storing **metadata only**:
`id`, `question_version_id`, `storage_key`, `alt_text`, `media_type`, `position`.

Images remain in Cloudflare R2 or another CDN/object store. Never store binary files
or private R2 credentials in PostgreSQL. Only PNG, JPEG and WebP are permitted.

## 🔧 Configuration

Add to a deployment-specific `.env` file (do not commit real credentials):

```dotenv
MAX_EXAM_QUESTIONS=100
MEDIA_BASE_URL=https://cdn.example.org/job-hackers
```

`MEDIA_BASE_URL` must be a public HTTPS delivery base (not a private R2 S3 endpoint
or permanent credential). An unset URL produces `url: null` in image metadata;
the client should render `alt_text` as a fallback. External image 404s and decoding
errors must be handled by the frontend's `<img>` error/fallback behavior.

### Publishing images

An administrator/JHEP-57's upload process should:
1. Validate and optimize the bytes (PNG, JPEG, WebP).
2. Store them in R2 under an immutable object key (e.g. `questions/{version_id}/{uuid}.webp`).
3. Insert a `question_images` row with that `storage_key`, image type, alt text, and position.
4. Never overwrite/delete media while referenced by a saved attempt.
5. Publish through an HTTPS CDN configured in `MEDIA_BASE_URL`.

**This follow-up does not implement uploads or provision R2 storage.**

### Mathematical notation

`question_text` is delivered unchanged. Use standard LaTeX math delimiters
`\(...\)` and `\[...\]` in content. Frontend teams should configure
KaTeX/MathJax (or equivalent) to render only those math regions and safely escape
ordinary HTML. API responses do not render mathematical images server-side.

## 🌐 API

`POST /api/v1/exams` is unchanged except for rejecting malformed MC questions,
the configurable maximum and a new optional `images` collection on each question.

`GET /api/v1/exams/{attempt_id}` requires JWT authentication and verifies ownership.
Returns `attempt_id`, `certification_id`, `status`, `question_count`,
`current_position`, and saved questions in their original order.
A foreign or nonexistent attempt returns the same `404` response. No answer keys.

**Important:** This GET endpoint does **not** autosave answers. That remains JHEP-32.

## 🧪 Local verification

From `backend/` on a disposable local PostgreSQL database:

```bash
ruff format .
ruff check .
ruff format --check .
pytest -q
RUN_DB_INTEGRATION=1 pytest -q
alembic upgrade head
alembic current
alembic check
```

Run `alembic upgrade head` **before** enabling DB tests that load the new table.


