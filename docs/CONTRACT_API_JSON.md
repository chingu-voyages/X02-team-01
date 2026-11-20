# JHEP — Current API Contract and Mock JSON Responses

**Current contract baseline:** `feat/JHEP-118-bulk-question-import`  
**Verified:** November 19, 2026  
**API prefix:** `/api/v1`

> This document describes the API implemented in the current JHEP codebase.
> Mock UUIDs, content, dates, tokens, URLs, and percentages below are examples only.
>
> `CURRENT` = implemented in the current baseline.  
> `PROPOSED` = not implemented in the current router and must not be treated as a live API contract.

The current system includes registration, verification, login/logout, password reset, role-based authorization, learner category discovery, category-aware randomized exams, save/resume/submission/results behavior, hosted question-media delivery, Contributor/Administrator question-image management through Cloudflare R2, scalable Question Bank search/filter/pagination, Contributor/Administrator XLSX bulk question import with validation/history/image staging, admin question management, question approval/rejection/retirement, certification management, category management, certification/category publication, and Administrator-managed user roles.

---

# 1. Global conventions

## 1.1 Authentication

Protected routes require:

```http
Authorization: Bearer <access_token>
```

Missing authentication:

```json
{
  "detail": "Authentication required"
}
```

Invalid or expired token:

```json
{
  "detail": "Invalid or expired authentication token"
}
```

Role failure:

```json
{
  "detail": "Insufficient permissions"
}
```

## 1.2 Roles

Current account roles:

- `learner`
- `contributor`
- `administrator`

Self-registration always creates a `learner`.

General content-management and bulk-import routes may allow Contributor or Administrator access. Approval, rejection, publication, retirement, catalog writes, and user-access management remain Administrator-only.

## 1.3 Error shapes

Auth-family coded errors use a top-level shape such as:

```json
{
  "code": "INVALID_CREDENTIALS",
  "message": "Invalid email or password"
}
```

Most non-auth failures use FastAPI's normal `detail` response.

Administrative conflicts may use a string:

```json
{
  "detail": "Only pending draft questions can be published"
}
```

Structured business/import conflicts may use:

```json
{
  "detail": {
    "code": "IMPORT_NOT_READY",
    "message": "Only a fully validated ready import can be committed"
  }
}
```

## 1.4 Question-media and answer-data safety

Learner-facing question responses never expose:

- `answer_options.is_correct`
- `text_answer_keys.expected_answer`
- unpublished review metadata
- raw media storage keys
- Cloudflare R2 credentials

Safe learner-facing image metadata:

```json
{
  "id": "99999999-9999-4999-8999-999999999999",
  "position": 1,
  "alt_text": "Diagram used by the question",
  "media_type": "image/png",
  "url": "https://cdn.example.test/questions/diagram.png"
}
```

Contributor/Administrator management routes may expose trusted answer configuration, but still never expose:

- `storage_key`
- `temporary_storage_key`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

Question-import asset responses expose safe filename/type/size/status metadata only.

## 1.5 Learner eligibility

A question is learner-eligible when:

- its certification is published;
- its question version has `review_status = "approved"`;
- its question version has `publication_status = "active"`;
- it is not flagged;
- its answer configuration is valid.

Learner category discovery additionally requires:

- the category is published;
- the certification has a passing threshold;
- the category contains at least one learner-eligible question.

Bulk-imported questions begin as `pending / draft`, so they are not learner-visible until the existing Administrator publication workflow approves them.

---

# 2. Route inventory

## 2.1 Auth

| Method | Route | Status | Auth |
|---|---|---|---|
| POST | `/api/v1/auth/register` | CURRENT | No |
| GET | `/api/v1/auth/verify?token={token}` | CURRENT | No |
| POST | `/api/v1/auth/resend-verification` | CURRENT | No |
| POST | `/api/v1/auth/login` | CURRENT | No |
| POST | `/api/v1/auth/logout` | CURRENT | Bearer |
| POST | `/api/v1/auth/forgot-password` | CURRENT | No |
| POST | `/api/v1/auth/reset-password` | CURRENT | No |
| GET | `/api/v1/auth/mfa/status` | CURRENT (JHEP-109) | Bearer |
| POST | `/api/v1/auth/mfa/enroll/setup` | CURRENT (JHEP-109) | Bearer |
| POST | `/api/v1/auth/mfa/enroll/verify` | CURRENT (JHEP-109) | Bearer |
| POST | `/api/v1/auth/mfa/verify` | CURRENT (JHEP-109) | Challenge token |


## 2.2 Learner discovery and delivery

| Method | Route | Status | Auth |
|---|---|---|---|
| GET | `/api/v1/categories?certification_id={certification_id}` | CURRENT | Bearer |
| GET | `/api/v1/questions` | CURRENT | Bearer |
| POST | `/api/v1/exams` | CURRENT | Bearer |
| GET | `/api/v1/exams/{attempt_id}` | CURRENT | Bearer |
| PATCH | `/api/v1/exams/{attempt_id}/progress` | CURRENT | Bearer |
| PUT | `/api/v1/exams/{attempt_id}/responses/{question_id}` | CURRENT | Bearer |
| POST | `/api/v1/exams/{attempt_id}/responses/{question_id}/submit` | CURRENT | Bearer |
| POST | `/api/v1/exams/{attempt_id}/submit` | CURRENT | Bearer |
| GET | `/api/v1/exams/{attempt_id}/results` | CURRENT | Bearer |

`{question_id}` on response routes accepts either the attempt-question addressing ID or the pinned `question_version_id`.

## 2.3 Admin — certifications and categories

| Method | Route | Status | Roles |
|---|---|---|---|
| GET | `/api/v1/admin/certifications` | CURRENT | Contributor/Admin |
| POST | `/api/v1/admin/certifications` | CURRENT | Admin |
| PATCH | `/api/v1/admin/certifications/{certification_id}/publication` | CURRENT | Admin |
| GET | `/api/v1/admin/categories?certification_id={certification_id}` | CURRENT | Contributor/Admin |
| POST | `/api/v1/admin/categories` | CURRENT | Admin |
| PATCH | `/api/v1/admin/categories/{category_id}/publication` | CURRENT | Admin |

## 2.4 Admin — Question Bank

| Method | Route | Status | Roles |
|---|---|---|---|
| GET | `/api/v1/admin/questions` | CURRENT | Contributor/Admin |
| POST | `/api/v1/admin/questions` | CURRENT | Contributor/Admin |
| GET | `/api/v1/admin/questions/{question_id}` | CURRENT | Contributor/Admin |
| PATCH | `/api/v1/admin/questions/{question_id}` | CURRENT | Contributor/Admin* |
| POST | `/api/v1/admin/questions/{question_id}/images` | CURRENT | Contributor/Admin* |
| PATCH | `/api/v1/admin/questions/{question_id}/images/{image_id}` | CURRENT | Contributor/Admin* |
| DELETE | `/api/v1/admin/questions/{question_id}/images/{image_id}` | CURRENT | Contributor/Admin* |
| POST | `/api/v1/admin/questions/{question_id}/publish` | CURRENT | Admin |
| POST | `/api/v1/admin/questions/{question_id}/reject` | CURRENT | Admin |
| POST | `/api/v1/admin/questions/{question_id}/retire` | CURRENT | Admin |

\* Contributors can modify only permitted questions they own. Administrators can manage any permitted question. Published content is revised through a new pending/draft version rather than edited in place.

## 2.5 Admin — bulk question imports (JHEP-118)

| Method | Route | Status | Roles |
|---|---|---|---|
| GET | `/api/v1/admin/question-imports` | CURRENT | Contributor/Admin |
| POST | `/api/v1/admin/question-imports` | CURRENT | Contributor/Admin |
| GET | `/api/v1/admin/question-imports/{batch_id}` | CURRENT | Contributor/Admin* |
| GET | `/api/v1/admin/question-imports/{batch_id}/rows` | CURRENT | Contributor/Admin* |
| POST | `/api/v1/admin/question-imports/{batch_id}/assets` | CURRENT | Contributor/Admin* |
| POST | `/api/v1/admin/question-imports/{batch_id}/cancel` | CURRENT (JHEP-189) | Contributor/Admin* |
| POST | `/api/v1/admin/question-imports/{batch_id}/revalidate` | CURRENT (JHEP-189) | Contributor/Admin* |
| POST | `/api/v1/admin/question-imports/{batch_id}/commit` | CURRENT | Contributor/Admin* |

\* Contributors can access only their own import batches. Administrators can access contributor batches.

## 2.6 Admin — users

| Method | Route | Status | Roles |
|---|---|---|---|
| GET | `/api/v1/admin/users?q=&limit=&offset=` | CURRENT | Admin |
| PATCH | `/api/v1/admin/users/{user_id}/role` | CURRENT | Admin |

## 2.7 Operational

| Method | Route | Status |
|---|---|---|
| GET | `/health` | CURRENT |

```json
{
  "status": "ok"
}
```

## 2.8 Not implemented

| Method | Route | Status |
|---|---|---|
| GET | `/api/v1/exam-catalog` | PROPOSED |
| GET | `/api/v1/exam-catalog/{catalog_id}` | PROPOSED |
| PATCH | `/api/v1/admin/exam-catalog/{catalog_id}/settings` | PROPOSED |
| GET | `/api/v1/exams/{attempt_id}/review` | PROPOSED |
| GET | `/api/v1/me/exam-attempts` | PROPOSED |

---

# 3. Authentication

## 3.1 Register — CURRENT

**POST** `/api/v1/auth/register`

```json
{
  "email": "learner@example.com",
  "full_name": "John Doe",
  "password": "Str0ngEn0ugh1"
}
```

`fullName` is also accepted as an alias for `full_name`.

Password policy:

- 8–128 characters;
- at least one uppercase letter;
- at least one lowercase letter;
- at least one digit;
- special characters optional.

Successful registration creates:

```text
role = learner
is_verified = false
```

Passwords are stored only as Argon2id hashes.

## 3.2 Verify / resend / login / logout — CURRENT

Verification:

```http
GET /api/v1/auth/verify?token={one_time_token}
```

Resend:

```http
POST /api/v1/auth/resend-verification
```

Login:

```http
POST /api/v1/auth/login
```

Example:

```json
{
  "email": "learner@example.com",
  "password": "Str0ngEn0ugh1"
}
```

Contributor and Administrator accounts use the same endpoint. The trusted database role is returned with the authenticated user.

Current frontend destinations:

```text
learner       -> /categories
contributor   -> /admin/questions
administrator -> /admin/questions
```

Logout is stateless: the client discards the JWT.

## 3.3 Password reset — CURRENT (JHEP-124)

```http
POST /api/v1/auth/forgot-password
POST /api/v1/auth/reset-password
```

Forgot-password responses are deliberately generic to avoid account enumeration.

A successful reset:

- applies the normal password policy;
- invalidates access tokens issued before the reset timestamp;
- does not change role/ownership.

---


## 3.9 Multi-factor authentication — enrollment — CURRENT (JHEP-109)

**Role policy (PO-confirmed):** Administrators MUST enroll; Contributors
MAY; Learners are not offered enrollment. The feature is dormant by
default — accounts without a confirmed enrollment get a byte-identical
sign-in response.

### GET `/api/v1/auth/mfa/status`

The account's MFA posture drives the Security page and the forced-enrollment
prompt:

```json
{
  "configured": true,
  "available": true,
  "mandatory": true,
  "enrolled": false
}
```

`configured: false` means the deployment lacks `MFA_ENCRYPTION_KEY`.
MFA is disabled and the rest of the application continues to run normally.

### POST `/api/v1/auth/mfa/enroll/setup`

Generates the account's TOTP secret. The secret is Fernet-encrypted at rest
with `MFA_ENCRYPTION_KEY`, which is optional at application startup.

```json
{
  "otpauth_uri": "otpauth://totp/The%20Job%20Hackers:learner%40example.com?secret=…&issuer=The%20Job%20Hackers",
  "secret": "<base32 secret for manual entry>",
  "issuer": "The Job Hackers"
}
```

The frontend renders `otpauth_uri` as a QR code for an authenticator app.
Calling setup again invalidates the prior unconfirmed secret.

### POST `/api/v1/auth/mfa/enroll/verify`

Confirms enrollment with a live six-digit code and issues recovery codes.
Recovery codes are shown once and stored only as SHA-256 digests.

```json
{
  "message": "MFA enabled. Store your recovery codes safely — they are shown once and never again.",
  "recovery_codes": ["4F7A2B91C0", "9C31E5D8A7", "..."]
}
```

| Status | Code | When |
|---|---|---|
| 400 | `INVALID_MFA_CODE` | the code does not match |
| 403 | `MFA_NOT_AVAILABLE` | the role is outside the enrollment policy |
| 409 | `MFA_NOT_ENROLLED` / `MFA_ALREADY_ENROLLED` | setup was not started / enrollment was already confirmed |
| 503 | `MFA_NOT_CONFIGURED` | the deployment lacks `MFA_ENCRYPTION_KEY` |

## 3.10 Multi-factor authentication — sign-in challenge — CURRENT (JHEP-109)

For an MFA-required account with a confirmed enrollment, a correct password
does not establish the final session. `POST /api/v1/auth/login` returns:

```json
{
  "access_token": "<5-minute challenge token — authorizes only /auth/mfa/verify>",
  "token_type": "bearer",
  "learner": { "...": "..." },
  "mfa_required": true,
  "challenge_id": "<challenge uuid>",
  "mfa_expires_in_seconds": 300
}
```

Use the challenge token as the Bearer credential for:

```http
POST /api/v1/auth/mfa/verify
```

Authenticator-code request:

```json
{
  "code": "123456"
}
```

Recovery-code request:

```json
{
  "code": "4F7A2B91C0",
  "recovery_code": true
}
```

Success returns the real authenticated session. Protected learner,
Contributor, and Administrator behavior unlocks only after the second factor.

| Status | Code | When |
|---|---|---|
| 400 | `INVALID_MFA_CODE` | wrong, repeated, or expired code |
| 403 | `MFA_CHALLENGE_LOCKED` | five failed attempts; a new login is required |
| 401 | `INVALID_MFA_CHALLENGE` | missing or expired challenge token |

Behavioral guarantees:

- Challenge tokens carry an `mfa: pending` claim and are rejected by
  `get_current_user` on every protected route.
- Password reset never bypasses MFA; the next sign-in still challenges.
- Failed or abandoned challenges expire after `MFA_CHALLENGE_MINUTES`,
  which defaults to five minutes.
- Enrollment is offered through `/account/security`, with a forced prompt
  for un-enrolled Administrators.

---

# 4. Learner category discovery

**GET** `/api/v1/categories`

Optional:

```http
GET /api/v1/categories?certification_id=<uuid>
```

A category appears only when its certification/category publication and eligible-question requirements are satisfied.

---

# 5. Learner question pool

**GET** `/api/v1/questions`

Returns learner-safe currently eligible questions.

Correct-answer flags and short-answer keys are not returned.

---

# 6. Practice exams

## 6.1 Start

**POST** `/api/v1/exams`

Category-scoped:

```json
{
  "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d",
  "category_id": "42e9c25f-4ada-5147-a894-d7fbcb0df5b7",
  "question_count": 10
}
```

Certification-wide:

```json
{
  "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d",
  "question_count": 10
}
```

Rules include:

- `question_count` 1–100;
- learner identity from the JWT;
- approved/active/unflagged questions only;
- selected category must belong to the certification;
- certification must have a passing threshold;
- one in-progress attempt per learner/certification.

## 6.2 Resume/progress/answers

```http
GET   /api/v1/exams/{attempt_id}
PATCH /api/v1/exams/{attempt_id}/progress
PUT   /api/v1/exams/{attempt_id}/responses/{question_id}
POST  /api/v1/exams/{attempt_id}/responses/{question_id}/submit
```

Submitted questions are locked.

## 6.3 Complete/results

```http
POST /api/v1/exams/{attempt_id}/submit
GET  /api/v1/exams/{attempt_id}/results
```

The server-provided `passed` value is authoritative. Short-answer questions may remain ungraded.

---

# 7. Admin content-management roles

## Contributor

Can:

- list certifications/categories;
- list owned managed questions;
- create question drafts;
- view/edit owned permitted questions;
- upload/replace/remove images on owned editable questions;
- search/filter/page through owned Question Bank records;
- upload/validate/review/confirm bulk question imports;
- view/reopen only their own import history.

Cannot:

- create certifications/categories;
- publish/unpublish catalog content;
- approve/publish questions;
- reject questions;
- retire questions;
- revise active published questions;
- manage Users & Access.

## Administrator

Can:

- manage all questions;
- create/publish/unpublish certifications/categories;
- upload/replace/remove question images;
- approve/publish/reject/retire questions;
- create revisions of active questions;
- bulk import questions;
- view all question-import history, including uploader identity;
- manage Learner/Contributor access.

Bulk import never bypasses Administrator-only review/publication.

---

# 8. Admin certifications/categories

Certification routes:

```http
GET   /api/v1/admin/certifications
POST  /api/v1/admin/certifications
PATCH /api/v1/admin/certifications/{certification_id}/publication
```

Category routes:

```http
GET   /api/v1/admin/categories?certification_id={certification_id}
POST  /api/v1/admin/categories
PATCH /api/v1/admin/categories/{category_id}/publication
```

New certifications/categories begin unpublished.

---

# 9. Admin Question Bank

## 9.1 Lifecycle

New/imported question:

```text
pending / draft
```

Administrator publication:

```text
pending / draft
        ↓
approved / active
```

Rejection:

```text
pending / draft
        ↓
rejected / draft
```

Editing a rejected draft returns it to `pending / draft`.

Administrator editing an active question creates a new version:

```text
v1 approved / active
v2 pending  / draft
```

Publishing the revision:

```text
v1 approved / retired
v2 approved / active
```

Historical learner attempts remain pinned to their stored version.

## 9.2 List managed questions — CURRENT

**GET** `/api/v1/admin/questions`

Administrators see all questions. Contributors see only questions they own.

Supported query parameters:

| Parameter | Behavior |
|---|---|
| `search` | question text, certification name/code, category name, or exact question UUID |
| `certification_id` | filter certification |
| `category_id` | filter category |
| `difficulty` | `easy`, `medium`, `hard` |
| `question_type` | `multiple_choice`, `short_answer` |
| `review_status` | `pending`, `approved`, `rejected` |
| `publication_status` | `draft`, `active`, `retired` |
| `has_image` | `true` / `false` |
| `page` | 1-based page, minimum 1 |
| `page_size` | optional, 1–100 |

When `page_size` is supplied, pagination occurs in SQL. `count` represents the total number of matching visible questions, not just the current page.

Question Bank rows include `has_image`.

## 9.3 Create/detail/edit

```http
POST  /api/v1/admin/questions
GET   /api/v1/admin/questions/{question_id}
PATCH /api/v1/admin/questions/{question_id}
```

Single-question create and edit use the same question validation rules reused by bulk import.

For authorized question-detail responses, `review_note` contains the
Administrator's latest rejection feedback when the current draft is rejected.
An owning Contributor can read that feedback so they know what to revise.
Editing/resubmitting the rejected draft clears `review_note` and returns the
question to `pending / draft`.

## 9.4 Images — CURRENT

```http
POST   /api/v1/admin/questions/{question_id}/images
PATCH  /api/v1/admin/questions/{question_id}/images/{image_id}
DELETE /api/v1/admin/questions/{question_id}/images/{image_id}
```

Current MVP:

- one image per question version;
- PNG/JPEG/WebP;
- default max encoded size 5 MiB;
- default max decoded size 20,000,000 pixels;
- alt text required;
- maximum alt text 1,000 characters;
- immutable R2 object keys.

The response never exposes `storage_key`.

## 9.5 Review/publication

```http
POST /api/v1/admin/questions/{question_id}/publish
POST /api/v1/admin/questions/{question_id}/reject
POST /api/v1/admin/questions/{question_id}/retire
```

All are Administrator-only.

---

# 10. Bulk question import — CURRENT (JHEP-118)

## 10.1 Authoring contract

Primary authoring format:

```text
.xlsx
```

The current v2 workbook has a `Questions` worksheet with exactly these 18 headers:

```text
template_version
certification_code
category_name
difficulty
question_type
allows_multiple_answers
question_text
option_a
option_b
option_c
option_d
option_e
option_f
correct_answers
expected_answer
explanation
image_filename
image_alt_text
```

Current upload constraints:

- `.xlsx` only;
- workbook max 5 MiB;
- max 1,000 nonblank question rows;
- formulas rejected;
- embedded workbook images/objects rejected;
- macro/external-link/data-connection content rejected;
- hidden data rows/import columns rejected;
- merged cells rejected;
- unknown/duplicate/missing headers rejected.

The workbook never controls review/publication state.

## 10.2 Create/validate import

**POST** `/api/v1/admin/question-imports`

`multipart/form-data`:

```text
file = questions.xlsx
```

Contributor/Admin.

The upload:

1. authenticates the manager;
2. reads/size-checks the workbook;
3. hashes exact workbook bytes;
4. returns an existing same-user batch on identical re-upload;
5. parses/stages every question row;
6. validates catalog references, answers, duplicates, math/image references, and existing question rules;
7. returns the batch summary.

Example ready response:

```json
{
  "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "original_filename": "questions.xlsx",
  "template_version": "2.0",
  "status": "ready",
  "total_rows": 3,
  "valid_rows": 3,
  "error_rows": 0,
  "warning_rows": 0,
  "imported_rows": 0,
  "can_import": true,
  "created_at": "2026-11-19T08:00:00Z",
  "validated_at": "2026-11-19T08:00:01Z",
  "imported_at": null
}
```

A structurally valid workbook can return `201` with `status = invalid` when row-level issues exist. No Question rows are created at this stage.

Identical same-user re-upload returns the existing batch rather than creating another batch. If that batch was cancelled, the same workbook reactivates the batch and runs validation again so the user is not trapped in a cancelled record.

## 10.3 Recent import history

**GET** `/api/v1/admin/question-imports`

Optional query parameters:

```text
status
page       (>= 1)
page_size  (1–100, default 20)
```

Allowed status values:

```text
uploaded
validating
invalid
ready
importing
imported
failed
cancelled
```

Contributor:

- sees only own batches.

Administrator:

- sees all batches.

Every authorized history item includes uploader ID/email/name. For a Contributor
those fields necessarily describe that same Contributor because the list is
ownership-scoped; the frontend currently surfaces uploader identity only in the
Administrator history view.

History items include the normal batch summary plus:

```json
{
  "uploaded_by_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "uploaded_by_email": "contributor@example.test",
  "uploaded_by_name": "Demo Contributor"
}
```

## 10.4 Get batch

**GET** `/api/v1/admin/question-imports/{batch_id}`

Contributor/Admin within batch scope.

Contributor access to another contributor's batch returns `404` to avoid probing.

## 10.5 Preview rows/issues

**GET** `/api/v1/admin/question-imports/{batch_id}/rows`

Optional:

```text
row_status = pending | valid | invalid | imported | failed
page
page_size  (1–100, default 50)
```

Example issue:

```json
{
  "sheet": "Questions",
  "row": 4,
  "field": "image_filename",
  "cell": null,
  "severity": "error",
  "code": "MISSING_IMAGE_FILE",
  "message": "Referenced image file has not been supplied to this import batch.",
  "value_preview": null,
  "related_rows": [],
  "asset_filename": "vpc.png"
}
```

Blocking errors keep `can_import = false`.

## 10.6 Add staged image asset

**POST** `/api/v1/admin/question-imports/{batch_id}/assets`

`multipart/form-data`:

```text
file = vpc.png
```

Supported image formats:

- PNG
- JPEG
- WebP

The backend:

1. normalizes the filename for case-insensitive matching;
2. validates actual image bytes and dimensions;
3. stages the immutable object in R2 under an internal import key;
4. stores safe metadata in PostgreSQL;
5. revalidates the entire batch.

Conceptual internal object key:

```text
imports/<batch-id>/<asset-id>.<extension>
```

The API response does not expose that storage key.

Identical same-filename/same-bytes re-upload is idempotent. The same normalized filename with different bytes returns a conflict.

If the asset satisfies the final missing image reference, the batch may transition automatically:

```text
invalid -> ready
```

## 10.7 Cancel uncommitted import — CURRENT (JHEP-189)

**POST** `/api/v1/admin/question-imports/{batch_id}/cancel`

Contributor/Admin within batch scope.

Allowed for uncommitted batch states:

```text
uploaded
validating
invalid
ready
failed
```

Cancellation:

1. locks the batch;
2. verifies ownership/Administrator scope;
3. rejects `importing` and `imported` batches;
4. removes temporary R2 objects when staged images exist;
5. marks staged assets `discarded`;
6. sets the batch status to `cancelled`;
7. preserves the batch and rows as a read-only audit record;
8. creates no Question records.

Repeated cancellation is idempotent.

Example:

```json
{
  "batch": {
    "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "status": "cancelled",
    "can_import": false
  },
  "discarded_asset_count": 2,
  "already_cancelled": false
}
```

Important conflict/error codes:

```text
IMPORT_CANNOT_BE_CANCELLED
IMPORT_ASSET_CLEANUP_UNAVAILABLE
```

## 10.8 Revalidate active import — CURRENT (JHEP-189)

**POST** `/api/v1/admin/question-imports/{batch_id}/revalidate`

Contributor/Admin within batch scope.

Revalidation is allowed for active uncommitted states:

```text
uploaded
invalid
ready
failed
```

It reruns the existing catalog, answer, duplicate, math and image rules
against current database state. This supports workflows such as an
Administrator creating a previously missing certification/category while
the Contributor keeps the staged workbook open.

The response is the refreshed batch summary. The batch becomes `ready`
only when no blocking row errors remain.

## 10.9 Confirm atomic import

**POST** `/api/v1/admin/question-imports/{batch_id}/commit`

The client sends no replacement row data; the server commits the already-staged/validated batch.

Allowed only when:

```text
status = ready
error_rows = 0
```

The commit rechecks:

- actor/batch scope;
- validation receipt completeness;
- duplicate identity against the current Question Bank;
- catalog scope through the normal question create rules;
- staged image metadata.

Success creates every row inside one database transaction as:

```text
version_number = 1
review_status = pending
publication_status = draft
is_flagged = false
created_by_id = original importing user
submitted_by_id = original importing user
```

A commit-time failure rolls back the entire batch. Partial Question creation is not allowed.

Successful receipt:

```json
{
  "batch": {
    "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "status": "imported",
    "total_rows": 3,
    "valid_rows": 3,
    "error_rows": 0,
    "imported_rows": 3,
    "can_import": false
  },
  "created_count": 3,
  "created_question_ids": [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333"
  ],
  "already_imported": false
}
```

A repeated commit of an already imported batch is idempotent and returns the existing created IDs with `already_imported = true`.

Important conflict codes:

```text
IMPORT_NOT_READY
IMPORT_STALE
IMPORT_DATA_INVALID
```

## 10.10 Duplicate policy

Import creates new questions only.

Duplicate identity:

```text
certification_id
category_id_or_null
question_type
normalized_question_text
```

Duplicates are checked:

- within the workbook;
- against the Question Bank during validation;
- again immediately before commit.

No upsert/update/merge/silent-skip behavior is implemented.

## 10.11 Import UI

Current frontend route:

```text
/admin/questions/import
```

The UI supports:

- template download;
- XLSX selection;
- validation summary;
- row preview and issues;
- Ready / Needs Attention filtering;
- missing-image filename display;
- multi-file image upload/drop;
- explicit all-or-nothing confirmation;
- success summary;
- Recent Imports history;
- reopen/continue/review behavior;
- grouped repeated validation errors;
- explicit revalidation after catalog/database changes;
- confirmed cancellation with temporary-asset cleanup;
- corrected-workbook replacement without leaving the page;
- read-only cancelled audit records.

The frontend does not expose an "import valid rows anyway" action.

---

# 11. Admin Users & Access — CURRENT

**GET** `/api/v1/admin/users`

Administrator only.

Supports `q`, `limit`, and `offset`.

**PATCH** `/api/v1/admin/users/{user_id}/role`

Administrator only.

Accepted target roles:

```text
learner
contributor
```

Role changes:

- take effect on the next protected request;
- preserve authored content/history;
- write a role-change audit record.

Administrator provisioning is separately governed and not exposed through this role-change endpoint.

---

# 12. End-to-end publication contract

```text
Administrator creates Certification
        ↓
unpublished

Administrator creates Category
        ↓
unpublished

Contributor/Admin creates OR imports Question
        ↓
pending / draft

Contributor/Admin may attach/stage image
        ↓
version-pinned media reference

Administrator approves + publishes Question
        ↓
approved / active

Administrator publishes Category
        ↓

Administrator publishes Certification
        ↓

GET /api/v1/categories
        ↓
Learner discovers category

POST /api/v1/exams
        ↓
Learner receives pinned question version + safe hosted image URL
```

Persisted attempts remain pinned to their original version.

---

# 13. Current frontend navigation

Application root:

```text
/
-> /login
```

After login:

```text
learner       -> /categories
contributor   -> /admin/questions
administrator -> /admin/questions
```

Contributor Question Bank includes:

```text
Create Question
Import Questions
```

Administrator additionally has Catalog and Users & Access navigation.

Frontend visibility does not replace backend authorization.

---

# 14. Current limits and important behavior

| Setting | Current limit / behavior |
|---|---|
| Exam question count | 1–100 |
| Selected option IDs per response | max 10 |
| Short-answer text | max 10,000 characters |
| Question rejection note | max 2,000 characters |
| Registration password | 8–128 chars + uppercase/lowercase/digit |
| Verification token lifetime | 24 hours |
| Verification resend interval | 60 seconds |
| Password-reset token lifetime | 1 hour default |
| Learner session token | default 12 hours |
| Question formats | `multiple_choice`, `short_answer` |
| Difficulty | `easy`, `medium`, `hard` |
| Review states | `pending`, `approved`, `rejected` |
| Publication states | `draft`, `active`, `retired` |
| Managed Question Bank page size | UI uses 50; API max 100 |
| Question image types | PNG, JPEG, WebP |
| Images per question version | 1 |
| Question image file size | default max 5 MiB |
| Question image decoded size | default max 20,000,000 pixels |
| Image alt text | required; max 1,000 chars |
| Bulk import authoring format | `.xlsx` contract v2 |
| Bulk workbook size | max 5 MiB |
| Bulk question rows | max 1,000 |
| Import history page size | default 20; max 100 |
| Import preview page size | default 50; max 100 |
| Bulk commit policy | all-or-nothing |
| Bulk imported initial state | `pending / draft` |
| Raw R2/storage keys | backend-only |

---

# 15. Proposed/not-yet-implemented resources and scope

The following remain proposed:

```text
GET   /api/v1/exam-catalog
GET   /api/v1/exam-catalog/{catalog_id}
PATCH /api/v1/admin/exam-catalog/{catalog_id}/settings
GET   /api/v1/exams/{attempt_id}/review
GET   /api/v1/me/exam-attempts
```

Question-bank batch actions such as bulk approve/publish/retire/category changes are also separate scope from JHEP-118.

---

# 16. Backend source of truth

Current behavior is defined primarily by:

```text
backend/app/api/v1/router.py
backend/app/api/v1/endpoints/auth.py
backend/app/api/v1/endpoints/categories.py
backend/app/api/v1/endpoints/questions.py
backend/app/api/v1/endpoints/exams.py
backend/app/api/v1/endpoints/admin.py
backend/app/api/v1/endpoints/question_imports.py

backend/app/schemas/auth.py
backend/app/schemas/category.py
backend/app/schemas/question.py
backend/app/schemas/exam.py
backend/app/schemas/admin_question.py
backend/app/schemas/admin_certification.py
backend/app/schemas/admin_category.py
backend/app/schemas/question_import.py

backend/app/models/question_import_batch.py
backend/app/models/question_import_row.py
backend/app/models/question_import_asset.py

backend/app/services/admin_question_service.py
backend/app/services/admin_question_bank_query_service.py
backend/app/services/admin_question_image_service.py
backend/app/services/question_image_validation.py
backend/app/services/question_import_parser.py
backend/app/services/question_import_validation_service.py
backend/app/services/question_import_asset_service.py
backend/app/services/question_import_commit_service.py
backend/app/services/r2_storage.py
```

When this document and code disagree, route decorators, Pydantic models, authorization dependencies, repository eligibility rules, and service behavior are the implementation source of truth.
