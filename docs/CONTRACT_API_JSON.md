# JHEP — Current API Contract and Mock JSON Responses

**Current contract baseline:** `feat/JHEP-165-question-image-management`  
**Verified:** November 16, 2026  
**API prefix:** `/api/v1`

> This document describes the API implemented in the current JHEP codebase. Mock UUIDs, content, dates, tokens, URLs, and percentages below are examples only.
>
> `CURRENT` = implemented in the current baseline.  
> `PROPOSED` = not implemented in the current router and must not be treated as a live API contract.

The current system includes registration, verification, login/logout, password reset, role-based authorization, learner category discovery, category-aware randomized exams, save/resume/submission/results behavior, hosted question-media delivery, Contributor/Administrator question-image management through Cloudflare R2, admin question management, question approval/rejection/retirement, certification management, category management, certification/category publication, and Administrator-managed user roles.

---

## 1. Global conventions

### 1.1 Authentication

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

### 1.2 Roles

Current account roles:

- `learner`
- `contributor`
- `administrator`

Self-registration always creates a `learner`.

General management routes may allow Contributor or Administrator access, while approval/publication/retirement, catalog writes, and user-access management remain Administrator-only.

### 1.3 Error shapes

Auth-family coded errors use a top-level shape:

```json
{
  "code": "INVALID_CREDENTIALS",
  "message": "Invalid email or password"
}
```

Most non-auth API failures use FastAPI's normal `detail` response.

Administrative conflicts generally use a string `detail`:

```json
{
  "detail": "Only pending draft questions can be published"
}
```

Exam business errors can use structured `detail` payloads:

```json
{
  "detail": {
    "code": "INSUFFICIENT_QUESTIONS",
    "requested": 10,
    "available": 4
  }
}
```

### 1.4 Question-media and answer-data safety

Learner-facing question responses never expose:

- `answer_options.is_correct`
- `text_answer_keys.expected_answer`
- unpublished review metadata
- raw media storage keys
- Cloudflare R2 credentials

Learner-facing hosted images use safe metadata only:

```json
{
  "id": "99999999-9999-4999-8999-999999999999",
  "position": 1,
  "alt_text": "Diagram used by the question",
  "media_type": "image/png",
  "url": "https://cdn.example.test/questions/diagram.png"
}
```

Contributor/Administrator management detail responses include trusted answer configuration and safe image metadata, but still never expose:

- `storage_key`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

The backend resolves private object keys to safe public HTTPS media URLs.

### 1.5 Learner eligibility

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

`{question_id}` on the save/submit routes accepts either the attempt-question addressing ID or the pinned `question_version_id`.

## 2.3 Admin — certifications and categories

| Method | Route | Status | Roles |
|---|---|---|---|
| GET | `/api/v1/admin/certifications` | CURRENT | Contributor/Admin |
| POST | `/api/v1/admin/certifications` | CURRENT | Admin |
| PATCH | `/api/v1/admin/certifications/{certification_id}/publication` | CURRENT | Admin |
| GET | `/api/v1/admin/categories?certification_id={certification_id}` | CURRENT | Contributor/Admin |
| POST | `/api/v1/admin/categories` | CURRENT | Admin |
| PATCH | `/api/v1/admin/categories/{category_id}/publication` | CURRENT | Admin |

## 2.4 Admin — questions

| Method | Route | Status | Roles |
|---|---|---|---|
| GET | `/api/v1/admin/questions` | CURRENT | Contributor/Admin |
| POST | `/api/v1/admin/questions` | CURRENT | Contributor/Admin |
| GET | `/api/v1/admin/questions/{question_id}` | CURRENT | Contributor/Admin |
| PATCH | `/api/v1/admin/questions/{question_id}` | CURRENT | Contributor/Admin* |
| POST | `/api/v1/admin/questions/{question_id}/images` | CURRENT | Contributor/Admin* |
| PATCH | `/api/v1/admin/questions/{question_id}/images/{image_id}` | CURRENT | Contributor/Admin* |
| DELETE | `/api/v1/admin/questions/{question_id}/images/{image_id}` | CURRENT | Contributor/Admin* |
| POST | `/api/v1/admin/questions/{question_id}/publish` | CURRENT |
| POST | `/api/v1/admin/questions/{question_id}/submit` | CURRENT (JHEP-119) | Bearer (the owning contributor) |
| POST | `/api/v1/admin/questions/{question_id}/start-review` | CURRENT (JHEP-119) | Bearer + administrator |
| POST | `/api/v1/admin/questions/{question_id}/request-changes` | CURRENT (JHEP-119) | Bearer + administrator | Admin |
| POST | `/api/v1/admin/questions/{question_id}/reject` | CURRENT | Admin |
| POST | `/api/v1/admin/questions/{question_id}/retire` | CURRENT | Admin |

\* Contributors can modify only permitted draft questions they own. Administrators can manage any permitted question. Published content is revised through a new draft version rather than edited in place.

## 2.5 Admin — users

| Method | Route | Status | Roles |
|---|---|---|---|
| GET | `/api/v1/admin/users?q=&limit=&offset=` | CURRENT | Admin |
| PATCH | `/api/v1/admin/users/{user_id}/role` | CURRENT | Admin |

## 2.6 Operational

| Method | Route | Status |
|---|---|---|
| GET | `/health` | CURRENT |

```json
{
  "status": "ok"
}
```

## 2.7 Not implemented

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

## 3.2 Verify email — CURRENT

**GET** `/api/v1/auth/verify?token={one_time_token}`

The token is single-use and expires after 24 hours.

Both outcomes redirect to the frontend login screen:

| Outcome | Redirect |
|---|---|
| Success | `{FRONTEND_BASE_URL}/login?verified=1` |
| Invalid/expired/used | `{FRONTEND_BASE_URL}/login?verification=invalid` |

## 3.3 Resend verification — CURRENT

**POST** `/api/v1/auth/resend-verification`

```json
{
  "email": "learner@example.com"
}
```

The response is intentionally generic to avoid account enumeration.

## 3.4 Login — CURRENT

**POST** `/api/v1/auth/login`

```json
{
  "email": "learner@example.com",
  "password": "Str0ngEn0ugh1"
}
```

Example response:

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer",
  "learner": {
    "id": "11111111-1111-4111-8111-111111111111",
    "email": "learner@example.com",
    "fullName": "John Doe",
    "role": "learner",
    "is_verified": true,
    "status": "verified",
    "created_at": "2026-11-12T18:00:00Z"
  }
}
```

Contributor and Administrator accounts use the same endpoint. Their trusted database role is returned in `learner.role`.

Current frontend destinations:

```text
learner       -> /categories
contributor   -> /admin/questions
administrator -> /admin/questions
```

## 3.5 Logout — CURRENT

**POST** `/api/v1/auth/logout`

Requires Bearer authentication.

Logout is stateless: the client discards the JWT. Server-side token invalidation is not currently implemented.

---

## 3.6 Forgot password — CURRENT (JHEP-124)

**POST** `/api/v1/auth/forgot-password`

AC1: the response is **byte-identical** whether or not the account
exists (no enumeration). AC4: rate-limited per account (60 s default —
`RATE_LIMITED` 429); the raw token never appears in logs or responses.

Request: `{"email": "learner@example.com"}`

Response (always):

```json
{"message": "If an account exists for that email, a password-reset link has been sent."}
```

The emailed link targets `{FRONTEND_BASE_URL}/reset-password?token={one_time_token}` —
works once, expires in 1 hour (`RESET_TOKEN_TTL_HOURS`), and a new
request invalidates prior unused challenges.

## 3.7 Reset password — CURRENT (JHEP-124)

**POST** `/api/v1/auth/reset-password`

Request: `{"token": "<one_time_token>", "new_password": "..."}`

Success:

```json
{"message": "Password updated. Sign in with your new password."}
```

| Status | Code | When |
|---|---|---|
| 400 | `INVALID_OR_EXPIRED_RESET_TOKEN` | unknown, expired (1 h), or already-used challenge |
| 422 | `WEAK_PASSWORD` | the new credential fails the registration policy |

Behavioral guarantees:

- **AC3**: the new password follows the registration password policy
  (same messages, one failed rule at a time).
- **AC5**: a successful reset stamps `sessions_invalid_before` on the
  account; every access token issued before that instant is rejected
  (stateless revocation via the JWT `iat`). Role/ownership are never
  touched.
- **MFA gate**: no second factor is enforced today; JHEP-109 must gate
  this flow when MFA lands — reset must never bypass a required second
  factor.

---

# 4. Learner category discovery

## GET `/api/v1/categories` — CURRENT

Optional filter:

```http
GET /api/v1/categories?certification_id=3c27471b-ed05-5433-b8c5-bf611b1dc12d
```

Example:

```json
{
  "categories": [
    {
      "id": "42e9c25f-4ada-5147-a894-d7fbcb0df5b7",
      "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d",
      "name": "Agile Principles",
      "certification_name": "Agile Fundamentals",
      "available_question_count": 36
    }
  ]
}
```

A category appears only when its certification/category publication and eligible-question requirements are satisfied.

---

# 5. Learner question pool

## GET `/api/v1/questions` — CURRENT

Returns learner-safe currently eligible questions.

```json
{
  "items": [
    {
      "id": "b7656038-9d60-5c70-aecb-d8fc62af2dd5",
      "question_text": "Which Scrum event is timeboxed to 15 minutes?",
      "question_type": "multiple_choice",
      "allows_multiple_answers": false,
      "difficulty": "easy",
      "options": [
        {
          "position": 1,
          "option_text": "Daily Scrum"
        },
        {
          "position": 2,
          "option_text": "Sprint Review"
        }
      ]
    }
  ],
  "count": 1
}
```

Correct-answer flags and short-answer keys are not returned.

---

# 6. Start practice exam

## POST `/api/v1/exams` — CURRENT

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
- learner identity comes from the JWT;
- only approved/active/unflagged questions are selected;
- selected category must belong to the certification and be published;
- certification must have a passing threshold;
- one in-progress attempt per learner/certification.

Example question payload:

```json
{
  "id": "b7656038-9d60-5c70-aecb-d8fc62af2dd5",
  "position": 1,
  "question_text": "What is the primary goal of iterative delivery?",
  "question_type": "multiple_choice",
  "allows_multiple_answers": false,
  "difficulty": "easy",
  "options": [
    {
      "id": "0777bf91-1d23-5059-93d4-dfa99abd914c",
      "position": 1,
      "option_text": "Deliver value and learn through feedback"
    }
  ],
  "images": [
    {
      "id": "99999999-9999-4999-8999-999999999999",
      "position": 1,
      "alt_text": "Diagram used by the question",
      "media_type": "image/png",
      "url": "https://cdn.example.test/questions/diagram.png"
    }
  ]
}
```

Supported learner-facing image types:

- `image/png`
- `image/jpeg`
- `image/webp`

Correct-answer flags are never included in the exam-start response.

---

# 7. Resume, progress, and answers

## 7.1 Resume attempt — CURRENT

**GET** `/api/v1/exams/{attempt_id}`

Only the owner can read the attempt. Missing and foreign attempts share the same 404 behavior.

Question content is pinned to the stored `question_version_id`, including version-specific hosted image metadata.

## 7.2 Save/update/clear answer — CURRENT

**PUT** `/api/v1/exams/{attempt_id}/responses/{question_id}`

Multiple-choice:

```json
{
  "selected_option_ids": [
    "66b3d8f0-2e47-53bd-bfb6-b54aaf5d0ed4"
  ],
  "text_response": null
}
```

Short-answer:

```json
{
  "selected_option_ids": null,
  "text_response": "The Product Owner maximizes product value."
}
```

Clear an unlocked draft:

```json
{}
```

## 7.3 Save navigation position — CURRENT

**PATCH** `/api/v1/exams/{attempt_id}/progress`

```json
{
  "current_position": 2
}
```

---

# 8. Submit answer and complete exam

## 8.1 Submit one question — CURRENT

**POST** `/api/v1/exams/{attempt_id}/responses/{question_id}/submit`

Immediate-feedback responses may include:

```json
{
  "feedback_released": true,
  "is_correct": false,
  "correct_option_ids": [
    "0777bf91-1d23-5059-93d4-dfa99abd914c"
  ],
  "explanation": "Iterative delivery encourages frequent feedback and adaptation."
}
```

Deferred mode returns `feedback_released: false` until appropriate.

Submitted questions are locked.

## 8.2 Complete exam — CURRENT

**POST** `/api/v1/exams/{attempt_id}/submit`

Example:

```json
{
  "attempt_id": "f45ab512-829f-55e7-bc44-e710396aa939",
  "status": "submitted",
  "question_count": 10,
  "answered_count": 10,
  "unanswered_count": 0,
  "submitted_at": "2026-11-12T19:05:01Z",
  "results_url": "/api/v1/exams/f45ab512-829f-55e7-bc44-e710396aa939/results"
}
```

---

# 9. Results

## GET `/api/v1/exams/{attempt_id}/results` — CURRENT

Example:

```json
{
  "attempt_id": "f45ab512-829f-55e7-bc44-e710396aa939",
  "status": "submitted",
  "question_count": 10,
  "answered_count": 10,
  "correct_count": 8,
  "incorrect_count": 2,
  "graded_count": 10,
  "points_earned": 8,
  "points_possible": 10,
  "score_percent": 80.0,
  "passing_score_percent": 70,
  "passed": true,
  "grading_complete": true
}
```

Short-answer questions can remain ungraded. The server-provided `passed` value is authoritative.

---

# 10. Admin content-management roles

## Contributor

Can:

- list certifications/categories;
- list owned managed questions;
- create question drafts;
- view owned questions;
- edit owned draft/rejected questions;
- upload an image to an owned editable question;
- replace/remove an image on an owned editable question.

Cannot:

- create certifications/categories;
- publish/unpublish certification/category content;
- approve/publish questions;
- reject questions;
- retire questions;
- create revisions of active published questions;
- modify media on an active published question;
- manage Users & Access.

## Administrator

Can:

- manage all questions;
- create/publish/unpublish certifications;
- create/publish/unpublish categories;
- upload/replace/remove question images;
- approve/publish questions;
- reject questions;
- create revisions of active questions;
- retire active questions;
- manage Learner/Contributor access.

Approval, rejection, publication, and retirement remain Administrator-only. The frontend hides those controls from Contributors, and the backend independently enforces the same restrictions.

---

# 11. Admin certifications

## 11.1 List — CURRENT

**GET** `/api/v1/admin/certifications`

Contributor/Admin.

## 11.2 Create — CURRENT

**POST** `/api/v1/admin/certifications`

Administrator only.

```json
{
  "name": "AWS Cloud Practitioner",
  "code": "CLF-C02",
  "passing_threshold_pct": 70,
  "feedback_mode": "immediate"
}
```

New certifications start unpublished.

## 11.3 Publication — CURRENT

**PATCH** `/api/v1/admin/certifications/{certification_id}/publication`

Administrator only.

```json
{
  "is_published": true
}
```

---

# 12. Admin categories

## 12.1 List — CURRENT

**GET** `/api/v1/admin/categories`

Optional `certification_id` filter.

Contributor/Admin.

## 12.2 Create — CURRENT

**POST** `/api/v1/admin/categories`

Administrator only.

```json
{
  "certification_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "name": "Scrum Fundamentals"
}
```

New categories start unpublished.

## 12.3 Publication — CURRENT

**PATCH** `/api/v1/admin/categories/{category_id}/publication`

Administrator only.

```json
{
  "is_published": true
}
```

---

# 13. Admin question bank

## 13.1 Lifecycle

New question:

```text
pending / draft
```

Administrator approval:

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

Editing a rejected draft returns it to:

```text
pending / draft
```

Administrator editing an active question creates a new version:

```text
v1 approved / active
v2 pending  / draft
```

Publishing the revision changes:

```text
v1 approved / retired
v2 approved / active
```

Historical attempts remain pinned to their original version.

## 13.2 List managed questions — CURRENT

**GET** `/api/v1/admin/questions`

Administrators see all questions. Contributors see only questions they own.

## 13.3 Create draft — CURRENT

**POST** `/api/v1/admin/questions`

Contributor/Admin.

Example MCQ:

```json
{
  "certification_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "category_id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "difficulty": "medium",
  "question_text": "Which Scrum accountability orders the Product Backlog?",
  "question_type": "multiple_choice",
  "allows_multiple_answers": false,
  "explanation": "The Product Owner manages the Product Backlog.",
  "options": [
    {
      "option_text": "Product Owner",
      "is_correct": true
    },
    {
      "option_text": "Scrum Master",
      "is_correct": false
    }
  ],
  "expected_answer": null
}
```

Server-controlled initial state:

```json
{
  "review_status": "pending",
  "publication_status": "draft"
}
```

## 13.4 Get managed detail — CURRENT

**GET** `/api/v1/admin/questions/{question_id}`

Contributor/Admin within role scope.

Example:

```json
{
  "question_id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  "question_version_id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  "version_number": 1,
  "certification_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "certification_name": "Professional Scrum Master I",
  "category_id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "category_name": "Scrum Fundamentals",
  "difficulty": "medium",
  "question_text": "Which Scrum accountability orders the Product Backlog?",
  "question_type": "multiple_choice",
  "allows_multiple_answers": false,
  "explanation": "The Product Owner manages the Product Backlog.",
  "review_status": "pending",
  "publication_status": "draft",
  "is_flagged": false,
  "created_by_id": "ffffffff-ffff-4fff-8fff-ffffffffffff",
  "submitted_by_id": "ffffffff-ffff-4fff-8fff-ffffffffffff",
  "last_updated": "2026-11-16T20:00:00Z",
  "options": [
    {
      "position": 1,
      "option_text": "Product Owner",
      "is_correct": true
    },
    {
      "position": 2,
      "option_text": "Scrum Master",
      "is_correct": false
    }
  ],
  "expected_answer": null,
  "images": [
    {
      "id": "99999999-9999-4999-8999-999999999999",
      "question_version_id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      "position": 1,
      "alt_text": "Circular Agile workflow showing Plan, Design, Develop, Test, Deploy, and Review stages.",
      "media_type": "image/png",
      "url": "https://cdn.example.test/questions/demo/agile.png"
    }
  ]
}
```

The response does not expose `storage_key`.

`url` may be `null` when public media delivery is unavailable.

## 13.5 Manage question image — CURRENT (JHEP-165)

Question images are uploaded through FastAPI and stored in Cloudflare R2. Browsers never receive R2 write credentials.

Current MVP:

- one image per question version;
- PNG/JPEG/WebP only;
- default maximum file size 5 MiB;
- default maximum decoded size 20,000,000 pixels;
- alt text required for attached informative images;
- maximum alt text length 1,000 characters.

Validation inspects actual image bytes rather than trusting only the filename/MIME header.

### Upload

**POST** `/api/v1/admin/questions/{question_id}/images`

`multipart/form-data`:

```text
file
alt_text
```

Successful HTTP `201`:

```json
{
  "id": "99999999-9999-4999-8999-999999999999",
  "question_version_id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  "position": 1,
  "alt_text": "Diagram showing the workflow.",
  "media_type": "image/png",
  "url": "https://cdn.example.test/questions/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/object.png"
}
```

PostgreSQL stores only:

```text
storage_key
alt_text
media_type
position
```

The image binary lives in R2.

Each upload uses a generated immutable object key.

### Replace

**PATCH** `/api/v1/admin/questions/{question_id}/images/{image_id}`

Uses the same multipart fields.

Replacement creates a **new immutable object key**. The old object is never overwritten in place.

If another question version still references the old key, the old R2 object is retained.

### Remove

**DELETE** `/api/v1/admin/questions/{question_id}/images/{image_id}`

Success:

```http
204 No Content
```

The DB reference is removed first. The R2 object is deleted only when no question-image row still references that key.

### Permissions/version integrity

Contributor:

- may manage media only on owned editable drafts;
- cannot modify media on an active published question.

Administrator:

- may manage media on any permitted draft;
- changing media on an active version first creates a new pending/draft revision;
- the existing active version keeps its original media association.

### Failure mapping

| HTTP | Meaning |
|---:|---|
| 403 | Media change requires Administrator permission |
| 404 | Question/image not found or outside caller scope |
| 409 | Invalid state or one-image limit reached |
| 413 | File exceeds configured byte limit |
| 415 | Unsupported media type |
| 422 | Empty/corrupt image, unsafe dimensions, or invalid/missing alt text |
| 503 | R2 storage unavailable/not configured |

Failed uploads do not corrupt the existing DB/media association.

## 13.6 Edit / create revision — CURRENT

**PATCH** `/api/v1/admin/questions/{question_id}`

Drafts are edited in place and return to `pending`.

For active published content:

- Contributor receives `403`;
- Administrator creates a new pending/draft version;
- category/difficulty remain unchanged because they live on the parent question record;
- version-associated media references are preserved into the draft revision.

## 13.7 Approve and publish — CURRENT

**POST** `/api/v1/admin/questions/{question_id}/publish`

Administrator only.

Allowed only for:

```text
review_status = pending
publication_status = draft
```

Publishing a revision retires the previous active version before activating the new one.

## 13.8 Reject — CURRENT

**POST** `/api/v1/admin/questions/{question_id}/reject`

Administrator only.

```json
{
  "review_note": "Please clarify the explanation."
}
```

Only a pending draft can be rejected.

## 13.9 Retire — CURRENT

**POST** `/api/v1/admin/questions/{question_id}/retire`

Administrator only.

```json
{
  "confirm": true
}
```

Retirement preserves version IDs and historical attempt references.

---

# 14. Admin Users & Access — CURRENT

## GET `/api/v1/admin/users`

Administrator only.

Supports `q`, `limit`, and `offset`.

Responses do not include password/hash data.

## PATCH `/api/v1/admin/users/{user_id}/role`

Administrator only.

Accepted target roles:

```text
learner
contributor
```

The Users & Access screen cannot provision Administrator accounts.

Important guarantees:

- database role is checked on every management request;
- revocation takes effect on the next request even with an old token;
- authored content remains intact;
- accepted role changes write an audit row.

---

# 15. End-to-end publication contract

```text
Administrator creates Certification
        ↓
unpublished

Administrator creates Category
        ↓
unpublished

Contributor/Admin creates Question
        ↓
pending / draft

Contributor/Admin may attach image
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

If content or media is revised later, persisted attempts retain their pinned historical version.

---

# 16. Current frontend navigation

Application root:

```text
/
→ /login
```

After login:

```text
learner       → /categories
contributor   → /admin/questions
administrator → /admin/questions
```

Role-aware navigation:

### Learner

- Practice Exams
- Logout

### Contributor

- Practice Exams
- Question Bank
- Logout

### Administrator

- Practice Exams
- Question Bank
- Catalog
- Users & Access
- Logout

Frontend visibility does not replace backend authorization.

---

# 17. Proposed/not-yet-implemented resources

The following remain proposed:

```text
GET   /api/v1/exam-catalog
GET   /api/v1/exam-catalog/{catalog_id}
PATCH /api/v1/admin/exam-catalog/{catalog_id}/settings
GET   /api/v1/exams/{attempt_id}/review
GET   /api/v1/me/exam-attempts
```

Do not build against these as live contracts.

---

# 18. Current limits and important behavior

| Setting | Current limit / behavior |
|---|---|
| Exam question count | 1–100 |
| Selected option IDs per response | max 10 |
| Short-answer text | max 10,000 characters |
| Question rejection note | max 2,000 characters |
| Registration password | 8–128 chars + uppercase/lowercase/digit |
| Verification token lifetime | 24 hours |
| Verification resend interval | 60 seconds |
| Password-reset token lifetime | 1 hour (default) |
| Password-reset request interval | 60 seconds (default) |
| Learner session token | default 12 hours |
| Question formats | `multiple_choice`, `short_answer` |
| Difficulty | `easy`, `medium`, `hard` |
| Feedback modes | `immediate`, `deferred` |
| Review states | `pending`, `approved`, `rejected` |
| Publication states | `draft`, `active`, `retired` |
| Image media types | PNG, JPEG, WebP |
| Images per question version | 1 in current MVP |
| Image file size | default max 5 MiB |
| Image decoded size | default max 20,000,000 pixels |
| Image alt text | required; max 1,000 characters |
| Image replacement | new immutable R2 object key |
| Raw storage keys | backend-only |
| R2 write credentials | backend-only |

---

# 19. Backend source of truth

Current contract behavior is defined primarily by:

```text
backend/app/api/v1/router.py
backend/app/api/v1/endpoints/auth.py
backend/app/api/v1/endpoints/categories.py
backend/app/api/v1/endpoints/questions.py
backend/app/api/v1/endpoints/exams.py
backend/app/api/v1/endpoints/admin.py

backend/app/schemas/auth.py
backend/app/schemas/category.py
backend/app/schemas/question.py
backend/app/schemas/exam.py
backend/app/schemas/admin_question.py
backend/app/schemas/admin_certification.py
backend/app/schemas/admin_category.py
backend/app/schemas/question_retirement.py

backend/app/repositories/category_repository.py
backend/app/repositories/question_eligibility.py
backend/app/repositories/sqlmodel_repository.py

backend/app/services/registration_service.py
backend/app/services/exam_service.py
backend/app/services/exam_attempt_service.py
backend/app/services/grading_service.py
backend/app/services/admin_question_service.py
backend/app/services/admin_question_image_service.py
backend/app/services/question_image_validation.py
backend/app/services/r2_storage.py
backend/app/services/media_url.py
backend/app/services/admin_certification_service.py
backend/app/services/admin_category_service.py
backend/app/services/question_retirement_service.py
```

When this document and code disagree, route decorators, Pydantic models, authorization dependencies, repository eligibility rules, and service behavior are the implementation source of truth.


# 4.x Review workflow — Submitted / In Review — CURRENT (JHEP-119)

The question review state machine (the ACs' flow):

```
Contributor: Draft --submit(own only)--> Submitted
Admin:       Submitted --start-review--> In Review
Admin:       In Review --publish--> approved + active   (the existing atomic action)
Admin:       In Review --request-changes(reason)--> pending/draft (the author reworks)
Admin:       In Review --reject(reason)--> rejected + inactive (terminal, retained)
Admin author: pending/draft --publish directly--> unchanged (JHEP-159's path)
```

- **Submit**: the owning contributor only (actor scoping); the
  publication status stays `draft` — submission never publishes (AC1).
- **Opening a submission changes nothing** (AC2): only Start Review
  moves Submitted → In Review, stamped with the reviewer.
- **Request Changes** requires a reason; the reason is kept as the
  version's review feedback and the author can edit/resubmit (AC3/AC4).
- **Reject** requires a reason and the outcome is terminal:
  `publication_status: inactive` — retained, never silently reactivated
  by editing (AC4; the pre-JHEP-119 edit-reset behavior was removed).
- **Concurrency (AC5)**: transition preconditions return 409 for
  out-of-order/duplicate requests (submit a submitted question, reject
  an inactive one, publish a non-draft source).
- **The review queue (AC2)**: `GET /admin/questions?review_status=submitted|in_review&author_email=…`
  — server-side filtering on top of the role scoping.
- **AC7**: the review outcome, actor, timestamp and reason live on the
  question version (`review_status`, `reviewed_by_id`, `reviewed_at`,
  `review_note`) and are visible on the question detail.
