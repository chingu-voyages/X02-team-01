# JHEP — Current API Contract and Mock JSON Responses

**Current contract baseline:** `feature/JHEP-159-publish-content` at commit `324b25a`  
**Verified:** November 12, 2026  
**API prefix:** `/api/v1`

> This document describes the API that is implemented in the current JHEP codebase. Mock UUIDs, content, dates, tokens, and percentages below are examples only.
>
> `CURRENT` = implemented in the current baseline.  
> `PROPOSED` = not implemented in the current router and must not be treated as a live API contract.

The previous version of this document was anchored to PR #18. That baseline is no longer authoritative. The current system includes registration, verification, login/logout, role-based authorization, learner category discovery, category-aware randomized exams, save/resume/submission/results behavior, question media metadata, admin question management, question approval/rejection/retirement, certification management, category management, and certification/category publication.

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

The current account roles are:

- `learner`
- `contributor`
- `administrator`

Self-registration always creates a `learner`.

General administrative route access requires `contributor` or `administrator`. Individual write operations can be further restricted to `administrator`.

### 1.3 Error shapes

Auth-family coded errors use a top-level shape:

```json
{
  "code": "INVALID_CREDENTIALS",
  "message": "Invalid email or password"
}
```

Auth schema-validation failures also use a top-level coded shape:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "email: Field required"
}
```

Most non-auth API validation failures use FastAPI's normal `detail` response.

Exam business errors generally use:

```json
{
  "detail": {
    "code": "INSUFFICIENT_QUESTIONS",
    "requested": 10,
    "available": 4
  }
}
```

Administrative conflicts generally use a string `detail`:

```json
{
  "detail": "Only pending draft questions can be published"
}
```

### 1.4 Learner-safe question delivery

Learner-facing question responses never expose:

- `answer_options.is_correct`
- `text_answer_keys.expected_answer`
- unpublished review metadata
- raw media storage keys

Administrator question-detail responses are trusted management responses and **do** include answer configuration.

### 1.5 Current learner-eligibility rules

A question is learner-eligible when:

- its certification is published;
- its question version has `review_status = "approved"`;
- its question version has `publication_status = "active"`;
- it is not flagged;
- a multiple-choice question has at least two options and a valid correct-answer configuration.

Learner category discovery additionally requires:

- the category is published;
- the certification has a passing threshold;
- the category contains at least one eligible question.

---

## 2. Route inventory

### 2.1 Auth

| Method | Route | Status | Auth |
|---|---|---|---|
| POST | `/api/v1/auth/register` | CURRENT | No |
| GET | `/api/v1/auth/verify?token={token}` | CURRENT | No |
| POST | `/api/v1/auth/resend-verification` | CURRENT | No |
| POST | `/api/v1/auth/login` | CURRENT | No |
| POST | `/api/v1/auth/logout` | CURRENT | Bearer |

### 2.2 Learner discovery and delivery

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

`{question_id}` on the save/submit routes accepts either the `exam_attempt_questions.id` addressing key or the pinned `question_version_id`. Current learner exam responses expose the question-version ID as each question's `id`, so that value remains a valid client key.

### 2.3 Admin — certifications and categories

| Method | Route | Status | Roles |
|---|---|---|---|
| GET | `/api/v1/admin/certifications` | CURRENT | Contributor/Admin |
| POST | `/api/v1/admin/certifications` | CURRENT | Admin |
| PATCH | `/api/v1/admin/certifications/{certification_id}/publication` | CURRENT | Admin |
| GET | `/api/v1/admin/categories?certification_id={certification_id}` | CURRENT | Contributor/Admin |
| POST | `/api/v1/admin/categories` | CURRENT | Admin |
| PATCH | `/api/v1/admin/categories/{category_id}/publication` | CURRENT | Admin |

### 2.4 Admin — questions

| Method | Route | Status | Roles |
|---|---|---|---|
| GET | `/api/v1/admin/questions` | CURRENT | Contributor/Admin |
| POST | `/api/v1/admin/questions` | CURRENT | Contributor/Admin |
| GET | `/api/v1/admin/questions/{question_id}` | CURRENT | Contributor/Admin |
| PATCH | `/api/v1/admin/questions/{question_id}` | CURRENT | Contributor/Admin* |
| POST | `/api/v1/admin/questions/{question_id}/publish` | CURRENT | Admin |
| POST | `/api/v1/admin/questions/{question_id}/reject` | CURRENT | Admin |
| POST | `/api/v1/admin/questions/{question_id}/retire` | CURRENT | Admin |

\* Contributors can edit permitted drafts they own. Only Administrators can create a new draft revision from already-published content.

### 2.5 Operational

| Method | Route | Status |
|---|---|---|
| GET | `/health` | CURRENT |

Response:

```json
{
  "status": "ok"
}
```

### 2.6 Not implemented

| Method | Route | Status |
|---|---|---|
| GET | `/api/v1/exam-catalog` | PROPOSED |
| GET | `/api/v1/exam-catalog/{catalog_id}` | PROPOSED |
| PATCH | `/api/v1/admin/exam-catalog/{catalog_id}/settings` | PROPOSED / legacy design concept |
| GET | `/api/v1/exams/{attempt_id}/review` | PROPOSED |
| GET | `/api/v1/me/exam-attempts` | PROPOSED |

---

# 3. Authentication

## 3.1 Register — CURRENT

**POST** `/api/v1/auth/register`

Request:

```json
{
  "email": "learner@example.com",
  "full_name": "John Doe",
  "password": "Str0ngEn0ugh1"
}
```

`fullName` is also accepted as an alias for `full_name`.

Password policy:

- minimum 8 characters;
- maximum 128 characters;
- at least one uppercase letter;
- at least one lowercase letter;
- at least one digit;
- no automatic trimming;
- special characters optional.

The password is stored only as an Argon2id hash.

Successful registration creates:

- `role = "learner"`
- `is_verified = false`
- no access token

**201 response**

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "email": "learner@example.com",
  "fullName": "John Doe",
  "role": "learner",
  "is_verified": false,
  "status": "pending_verification",
  "created_at": "2026-11-12T18:00:00Z"
}
```

Common coded failures:

```json
{
  "code": "EMAIL_TAKEN",
  "message": "An account with this email already exists"
}
```

```json
{
  "code": "WEAK_PASSWORD",
  "message": "Password must contain an uppercase letter"
}
```

---

## 3.2 Verify email — CURRENT

**GET** `/api/v1/auth/verify?token={one_time_token}`

The verification token:

- expires after 24 hours;
- is single-use;
- is stored only as a SHA-256 digest.

**200 response**

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "email": "learner@example.com",
  "fullName": "John Doe",
  "role": "learner",
  "is_verified": true,
  "status": "verified",
  "created_at": "2026-11-12T18:00:00Z"
}
```

Invalid, expired, and already-used links all fail through the same coded class:

```json
{
  "code": "INVALID_OR_EXPIRED_TOKEN",
  "message": "Verification link is invalid"
}
```

---

## 3.3 Resend verification — CURRENT

**POST** `/api/v1/auth/resend-verification`

Request:

```json
{
  "email": "learner@example.com"
}
```

The account-level resend interval is 60 seconds.

**200 response**

```json
{
  "message": "If the account exists and is unverified, a verification email has been sent."
}
```

The generic success response does not reveal whether an account exists.

Rate-limit failure:

```json
{
  "code": "RATE_LIMITED",
  "message": "Please wait before requesting another verification email"
}
```

---

## 3.4 Login — CURRENT

**POST** `/api/v1/auth/login`

Request:

```json
{
  "email": "learner@example.com",
  "password": "Str0ngEn0ugh1"
}
```

**200 response**

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

Administrator and contributor accounts use the same login endpoint. Their trusted database role is returned in `learner.role`.

Unknown email, wrong password, and accounts without a credential hash share the same response:

```json
{
  "code": "INVALID_CREDENTIALS",
  "message": "Invalid email or password"
}
```

Unverified account:

```json
{
  "detail": {
    "code": "ACCOUNT_NOT_VERIFIED",
    "message": "Verify your email before signing in — the verification link was sent to your address."
  }
}
```

---

## 3.5 Logout — CURRENT

**POST** `/api/v1/auth/logout`

Requires Bearer authentication.

No request body.

**200 response**

```json
{
  "message": "Logged out",
  "logged_out_at": "2026-11-12T19:15:00+00:00"
}
```

Logout is stateless. The client discards the JWT; server-side invalidation is not currently implemented.

---

# 4. Screen 03 — Learner category selection

## 4.1 Available categories — CURRENT

**GET** `/api/v1/categories`

Optional filter:

```http
GET /api/v1/categories?certification_id=3c27471b-ed05-5433-b8c5-bf611b1dc12d
```

**200 response**

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

An empty result is valid:

```json
{
  "categories": []
}
```

A category appears only when:

1. the certification is published;
2. the category is published;
3. the certification has a passing threshold;
4. the category contains at least one learner-eligible question.

Database availability failure:

```json
{
  "detail": "Practice exam categories are temporarily unavailable"
}
```

with HTTP `503`.

---

## 4.2 Exam catalog — PROPOSED

**GET** `/api/v1/exam-catalog`

This route does not currently exist.

The current learner flow uses `/api/v1/categories` as the discovery endpoint and then posts the selected `certification_id`, `category_id`, and `question_count` to `/api/v1/exams`.

Do not build frontend integration against `/exam-catalog` unless a future ticket implements it.

---

# 5. Current learner question-pool endpoint

## GET `/api/v1/questions` — CURRENT

Returns all questions currently eligible through the global delivery query.

**200 response**

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

`id` is the question-version ID.

This endpoint does not expose correct-answer flags or short-answer keys.

The global eligibility query requires a published certification and an approved/active/unflagged question version. Category publication is enforced by the category-discovery/category-start flow rather than by this global endpoint.

---

# 6. Screen 04 — Exam instructions

## GET `/api/v1/exam-catalog/{catalog_id}` — PROPOSED

This route is not implemented.

The current frontend must derive instructions/display labels from its existing UI state or static copy. There is no backend exam-instructions resource at this route.

---

# 7. Screen 05 — Start exam

## POST `/api/v1/exams` — CURRENT

The request may be certification-wide or category-scoped.

### Category-scoped request

```json
{
  "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d",
  "category_id": "42e9c25f-4ada-5147-a894-d7fbcb0df5b7",
  "question_count": 2
}
```

### Certification-wide request

```json
{
  "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d",
  "question_count": 2
}
```

Rules:

- `question_count` must be an integer from 1–100;
- learner identity comes from the token, never request JSON;
- category-scoped selection is constrained to that category;
- category must belong to the selected certification;
- category must be published;
- only published certifications contribute eligible questions;
- the certification must have a passing threshold;
- only approved, active, unflagged questions are selected;
- a learner cannot have two `in_progress` attempts for the same certification.

**201 response**

```json
{
  "attempt_id": "f45ab512-829f-55e7-bc44-e710396aa939",
  "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d",
  "status": "in_progress",
  "question_count": 2,
  "questions": [
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
        },
        {
          "id": "66b3d8f0-2e47-53bd-bfb6-b54aaf5d0ed4",
          "position": 2,
          "option_text": "Avoid sharing work until the end"
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
  ]
}
```

The question's `id` is the pinned question-version ID.

`images[].url` is omitted when a public `MEDIA_BASE_URL` is not configured or the stored media key cannot be safely converted into a delivery URL. Supported media types are:

- `image/png`
- `image/jpeg`
- `image/webp`

Correct-answer flags are never returned here.

### Current start errors

| Code / detail | HTTP | Meaning |
|---|---:|---|
| `CERTIFICATION_NOT_FOUND` | 404 | Unknown certification |
| `CATEGORY_NOT_FOUND` | 404 | Category missing or belongs to another certification |
| `CATEGORY_UNAVAILABLE` | 409 | Selected category is unpublished |
| `ATTEMPT_IN_PROGRESS` | 409 | Learner already has an unfinished attempt for the certification |
| `MISSING_THRESHOLD` | 409 | Certification has no passing threshold |
| `INSUFFICIENT_QUESTIONS` | 409 | Eligible pool is smaller than requested |
| validation error | 422 | Invalid request shape/count |

Example:

```json
{
  "detail": {
    "code": "ATTEMPT_IN_PROGRESS",
    "attempt_id": "f45ab512-829f-55e7-bc44-e710396aa939"
  }
}
```

```json
{
  "detail": {
    "code": "INSUFFICIENT_QUESTIONS",
    "requested": 10,
    "available": 4
  }
}
```

An unpublished certification contributes no learner-eligible questions. There is currently no dedicated `CERTIFICATION_UNAVAILABLE` error code, so a direct start that bypasses discovery can resolve to an insufficient eligible pool.

The exam response does **not** currently return `category_name`, `certification_name`, `catalog_id`, or `passing_score_percent`. Those are UI/display concerns carried separately by the frontend.

---

# 8. Screen 06 — Resume, save answers, and navigation

## 8.1 Resume attempt — CURRENT

**GET** `/api/v1/exams/{attempt_id}`

Only the owner can read the attempt. Missing and foreign attempts return the same 404 response.

**200 response**

```json
{
  "attempt_id": "f45ab512-829f-55e7-bc44-e710396aa939",
  "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d",
  "status": "in_progress",
  "question_count": 2,
  "current_position": 2,
  "questions": [
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
        },
        {
          "id": "66b3d8f0-2e47-53bd-bfb6-b54aaf5d0ed4",
          "position": 2,
          "option_text": "Avoid sharing work until the end"
        }
      ],
      "images": [],
      "response": {
        "question_version_id": "b7656038-9d60-5c70-aecb-d8fc62af2dd5",
        "selected_option_ids": [
          "66b3d8f0-2e47-53bd-bfb6-b54aaf5d0ed4"
        ],
        "is_submitted": false,
        "answered_at": "2026-11-12T19:01:00Z"
      }
    }
  ]
}
```

A question with no saved answer has no `response` property.

Null fields are omitted because the route uses `response_model_exclude_none=True`.

While the attempt is `in_progress`, the resume route does not echo correctness, even when an individual question previously released immediate feedback.

---

## 8.2 Save/update/clear an answer — CURRENT

**PUT** `/api/v1/exams/{attempt_id}/responses/{question_id}`

`{question_id}` accepts either:

- the attempt-question primary key, or
- the pinned question-version ID.

### Multiple-choice request

```json
{
  "selected_option_ids": [
    "66b3d8f0-2e47-53bd-bfb6-b54aaf5d0ed4"
  ],
  "text_response": null
}
```

### Short-answer request

```json
{
  "selected_option_ids": null,
  "text_response": "The Product Owner maximizes product value."
}
```

### Clear an unlocked draft

```json
{}
```

**200 response**

```json
{
  "attempt_id": "f45ab512-829f-55e7-bc44-e710396aa939",
  "question_version_id": "b7656038-9d60-5c70-aecb-d8fc62af2dd5",
  "selected_option_ids": [
    "66b3d8f0-2e47-53bd-bfb6-b54aaf5d0ed4"
  ],
  "is_submitted": false,
  "answered_at": "2026-11-12T19:01:00Z",
  "question_count": 2,
  "answered_count": 1,
  "unanswered_count": 1
}
```

Rules:

- selected options must belong to the pinned version;
- a single-select MCQ cannot save multiple option IDs;
- text and option selections cannot be supplied together;
- an individually submitted question is locked;
- a finally submitted attempt rejects further writes.

---

## 8.3 Save navigation position — CURRENT

**PATCH** `/api/v1/exams/{attempt_id}/progress`

Request:

```json
{
  "current_position": 2
}
```

**200 response**

```json
{
  "attempt_id": "f45ab512-829f-55e7-bc44-e710396aa939",
  "status": "in_progress",
  "current_position": 2,
  "question_count": 2,
  "answered_count": 1,
  "unanswered_count": 1
}
```

`current_position` must be within the attempt's question range.

---

# 9. Screen 07 — Submit answer and complete exam

## 9.1 Submit one question — CURRENT

**POST** `/api/v1/exams/{attempt_id}/responses/{question_id}/submit`

Send the answer in the submit request, even if a draft was previously saved.

### Immediate-feedback MCQ request

```json
{
  "selected_option_ids": [
    "66b3d8f0-2e47-53bd-bfb6-b54aaf5d0ed4"
  ],
  "text_response": null
}
```

### Immediate-feedback response

```json
{
  "attempt_id": "f45ab512-829f-55e7-bc44-e710396aa939",
  "question_version_id": "b7656038-9d60-5c70-aecb-d8fc62af2dd5",
  "is_submitted": true,
  "question_submitted_at": "2026-11-12T19:01:05Z",
  "feedback_released": true,
  "is_correct": false,
  "correct_option_ids": [
    "0777bf91-1d23-5059-93d4-dfa99abd914c"
  ],
  "explanation": "Iterative delivery encourages frequent feedback and adaptation."
}
```

### Deferred-feedback response

```json
{
  "attempt_id": "f45ab512-829f-55e7-bc44-e710396aa939",
  "question_version_id": "b7656038-9d60-5c70-aecb-d8fc62af2dd5",
  "is_submitted": true,
  "question_submitted_at": "2026-11-12T19:01:05Z",
  "feedback_released": false
}
```

Submitting a question locks that response.

An empty submit returns `422`.

Short-answer questions are not automatically scored. In immediate mode their explanation may be released, but automatic correctness is not produced.

---

## 9.2 Complete exam — CURRENT

**POST** `/api/v1/exams/{attempt_id}/submit`

No request body.

**200 response**

```json
{
  "attempt_id": "f45ab512-829f-55e7-bc44-e710396aa939",
  "status": "submitted",
  "question_count": 2,
  "answered_count": 2,
  "unanswered_count": 0,
  "submitted_at": "2026-11-12T19:05:01Z",
  "results_url": "/api/v1/exams/f45ab512-829f-55e7-bc44-e710396aa939/results"
}
```

Important current behavior:

- saving a draft is **not** the same as submitting that answer;
- final exam submission does not turn unlocked drafts into individually submitted answers;
- automatic grading reads individually submitted answer rows;
- a saved-but-unsubmitted response can count as `answered` while grading treats its gradable question as unanswered;
- repeated final submission returns `409`.

---

# 10. Screen 08 — Results and Try Again

## 10.1 Results — CURRENT

**GET** `/api/v1/exams/{attempt_id}/results`

The attempt must already be submitted.

**200 response**

```json
{
  "attempt_id": "f45ab512-829f-55e7-bc44-e710396aa939",
  "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d",
  "status": "submitted",
  "question_count": 2,
  "answered_count": 2,
  "unanswered_count": 0,
  "correct_count": 1,
  "incorrect_count": 1,
  "unanswered_graded_count": 0,
  "ungraded_count": 0,
  "ungradable_count": 0,
  "graded_count": 2,
  "points_earned": 1,
  "points_possible": 2,
  "score_percent": 50.0,
  "score_basis": "graded_questions_only",
  "passing_score_percent": 70,
  "passed": false,
  "grading_complete": true,
  "submitted_at": "2026-11-12T19:05:01Z",
  "graded_at": "2026-11-12T19:05:02Z"
}
```

Definitions:

- `incorrect_count` excludes `unanswered_graded_count`;
- short-answer questions contribute to `ungraded_count`;
- invalid/unusable answer-key configurations contribute to `ungradable_count`;
- `graded_count` is `correct + incorrect + unanswered_graded`;
- ungraded/ungradable questions are excluded from the score denominator;
- `score_percent` and `passed` are `null` when there are zero gradable questions;
- use the server's `passed` value rather than recomputing from a displayed percentage.

The passing threshold and feedback mode are snapshotted when the attempt is created. Later admin publication/configuration changes do not modify an existing attempt.

The results API currently returns aggregates only. It does not return the full answer key or a review URL.

---

## 10.2 Try Again — CURRENT

Use **POST** `/api/v1/exams` to create a new attempt after the previous attempt is submitted.

Example:

```json
{
  "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d",
  "category_id": "42e9c25f-4ada-5147-a894-d7fbcb0df5b7",
  "question_count": 10
}
```

A new `attempt_id` is created.

A fresh attempt can receive some of the same randomized questions as an earlier attempt.

---

# 11. Admin content management — CURRENT

The current admin console manages the actual content lifecycle used by learner discovery.

## 11.1 Role behavior

### Contributor

Can:

- list certifications and categories;
- list their own managed questions;
- create question drafts;
- view their own managed questions;
- edit their own draft/rejected questions.

Cannot:

- create certifications;
- create categories;
- publish/unpublish certification/category content;
- publish/reject questions;
- retire questions;
- create revisions of active published questions.

### Administrator

Can:

- manage all questions;
- create certifications;
- create categories;
- publish/unpublish certifications;
- publish/unpublish categories;
- approve/publish questions;
- reject questions;
- create revisions of active questions;
- retire active questions.

---

# 12. Admin certifications

## 12.1 List certifications — CURRENT

**GET** `/api/v1/admin/certifications`

Contributor/Admin.

Returns both published and unpublished certifications.

**200 response**

```json
{
  "items": [
    {
      "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "name": "Professional Scrum Master I",
      "code": "PSM-I",
      "passing_threshold_pct": 70,
      "feedback_mode": "immediate",
      "is_published": true
    },
    {
      "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "name": "AWS Cloud Practitioner",
      "code": "CLF-C02",
      "passing_threshold_pct": 70,
      "feedback_mode": "deferred",
      "is_published": false
    }
  ],
  "count": 2
}
```

---

## 12.2 Create certification — CURRENT

**POST** `/api/v1/admin/certifications`

Administrator only.

Request:

```json
{
  "name": "AWS Cloud Practitioner",
  "code": "clf-c02",
  "passing_threshold_pct": 70,
  "feedback_mode": "immediate"
}
```

Rules:

- `name`: trimmed, 1–255 characters;
- `code`: trimmed and normalized to uppercase, 1–50 characters;
- `passing_threshold_pct`: integer 0–100;
- `feedback_mode`: `immediate` or `deferred`;
- new certifications are created unpublished.

**201 response**

```json
{
  "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "name": "AWS Cloud Practitioner",
  "code": "CLF-C02",
  "passing_threshold_pct": 70,
  "feedback_mode": "immediate",
  "is_published": false
}
```

Duplicate code:

```json
{
  "detail": "A certification with this code already exists"
}
```

HTTP `409`.

---

## 12.3 Publish/unpublish certification — CURRENT

**PATCH** `/api/v1/admin/certifications/{certification_id}/publication`

Administrator only.

Request:

```json
{
  "is_published": true
}
```

**200 response**

```json
{
  "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "name": "AWS Cloud Practitioner",
  "code": "CLF-C02",
  "passing_threshold_pct": 70,
  "feedback_mode": "immediate",
  "is_published": true
}
```

Unknown certification:

```json
{
  "detail": "Certification not found"
}
```

HTTP `404`.

Unpublishing a certification removes its questions from the learner-eligible pool and hides its categories from learner discovery. Existing persisted attempts are not rewritten.

---

# 13. Admin categories

## 13.1 List categories — CURRENT

**GET** `/api/v1/admin/categories`

Optional filter:

```http
GET /api/v1/admin/categories?certification_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
```

Contributor/Admin.

Unlike the learner `/categories` route, this management endpoint returns both published and unpublished categories.

**200 response**

```json
{
  "items": [
    {
      "id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "certification_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "certification_name": "Professional Scrum Master I",
      "name": "Scrum Fundamentals",
      "is_published": false
    }
  ],
  "count": 1
}
```

---

## 13.2 Create category — CURRENT

**POST** `/api/v1/admin/categories`

Administrator only.

Request:

```json
{
  "certification_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "name": "Scrum Fundamentals"
}
```

New categories are created unpublished.

**201 response**

```json
{
  "id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "certification_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "certification_name": "Professional Scrum Master I",
  "name": "Scrum Fundamentals",
  "is_published": false
}
```

Category names are unique case-insensitively within a certification.

Duplicate:

```json
{
  "detail": "A category with this name already exists for this certification"
}
```

HTTP `409`.

Unknown parent certification:

```json
{
  "detail": "Certification not found"
}
```

HTTP `404`.

---

## 13.3 Publish/unpublish category — CURRENT

**PATCH** `/api/v1/admin/categories/{category_id}/publication`

Administrator only.

Request:

```json
{
  "is_published": true
}
```

**200 response**

```json
{
  "id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "certification_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "certification_name": "Professional Scrum Master I",
  "name": "Scrum Fundamentals",
  "is_published": true
}
```

Publishing a category does not by itself make it learner-visible. Its certification must also be published and it must contain at least one learner-eligible question.

---

# 14. Admin question bank

## 14.1 Question lifecycle

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

Editing a rejected draft resets its review state to:

```text
pending / draft
```

Editing an active published question as an Administrator creates a **new version**:

```text
v1 approved / active
v2 pending  / draft
```

Publishing the revision atomically changes:

```text
v1 approved / retired
v2 approved / active
```

Rejecting the revision leaves the old live version unchanged:

```text
v1 approved / active
v2 rejected / draft
```

Retirement marks every stored version of the question as `retired` while preserving IDs for historical attempt references.

---

## 14.2 List managed questions — CURRENT

**GET** `/api/v1/admin/questions`

Contributor/Admin.

Administrators see all question records. Contributors see only questions they own.

**200 response**

```json
{
  "items": [
    {
      "question_id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      "question_version_id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      "version_number": 1,
      "question_preview": "What is the primary purpose of the Daily Scrum?",
      "certification_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "certification_name": "Professional Scrum Master I",
      "category_id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "category_name": "Scrum Fundamentals",
      "difficulty": "easy",
      "question_type": "multiple_choice",
      "review_status": "pending",
      "publication_status": "draft",
      "is_flagged": false,
      "created_by_id": "ffffffff-ffff-4fff-8fff-ffffffffffff",
      "last_updated": "2026-11-12T19:30:00Z"
    }
  ],
  "count": 1
}
```

---

## 14.3 Create question draft — CURRENT

**POST** `/api/v1/admin/questions`

Contributor/Admin.

### Multiple-choice request

```json
{
  "certification_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "category_id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "difficulty": "medium",
  "question_text": "Which Scrum accountability orders the Product Backlog?",
  "question_type": "multiple_choice",
  "allows_multiple_answers": false,
  "explanation": "The Product Owner is accountable for effective Product Backlog management.",
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

### Short-answer request

```json
{
  "certification_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "category_id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "difficulty": "medium",
  "question_text": "What is the Product Owner accountable for?",
  "question_type": "short_answer",
  "allows_multiple_answers": false,
  "explanation": "The Product Owner maximizes product value.",
  "options": [],
  "expected_answer": "Maximizing the value of the product resulting from the work of the Scrum Team."
}
```

`category_id` is nullable at the API level, although the current admin UI expects a category selection.

Rules:

- certification must exist;
- category, when supplied, must exist and belong to that certification;
- question text cannot be blank;
- difficulty is `easy`, `medium`, or `hard`;
- MCQ requires at least two options and at least one correct option;
- single-select MCQ requires exactly one correct option;
- short answer requires `expected_answer`;
- short answer cannot contain MCQ options.

New drafts always start server-controlled as:

```json
{
  "review_status": "pending",
  "publication_status": "draft"
}
```

**201 response**

```json
{
  "question_id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  "question_version_id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  "version_number": 1,
  "review_status": "pending",
  "publication_status": "draft"
}
```

Clients cannot override review/publication state in the create payload.

---

## 14.4 Get managed question detail — CURRENT

**GET** `/api/v1/admin/questions/{question_id}`

Contributor/Admin, within role scope.

This trusted management response includes answer configuration.

**200 response — MCQ**

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
  "explanation": "The Product Owner is accountable for effective Product Backlog management.",
  "review_status": "pending",
  "publication_status": "draft",
  "is_flagged": false,
  "created_by_id": "ffffffff-ffff-4fff-8fff-ffffffffffff",
  "submitted_by_id": "ffffffff-ffff-4fff-8fff-ffffffffffff",
  "last_updated": "2026-11-12T19:30:00Z",
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
  "expected_answer": null
}
```

The management detail currently does **not** return `review_note`, even though rejection notes are persisted.

---

## 14.5 Edit question / create revision — CURRENT

**PATCH** `/api/v1/admin/questions/{question_id}`

Request shape is the draft-content shape **without** `certification_id`.

Example:

```json
{
  "category_id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "difficulty": "medium",
  "question_text": "Updated question text",
  "question_type": "multiple_choice",
  "allows_multiple_answers": false,
  "explanation": "Updated explanation",
  "options": [
    {
      "option_text": "Correct",
      "is_correct": true
    },
    {
      "option_text": "Incorrect",
      "is_correct": false
    }
  ],
  "expected_answer": null
}
```

Draft behavior:

- edits the current draft in place;
- resets review state to `pending`;
- clears prior reviewer/review timestamp/review note.

Published behavior:

- Contributor: `403`;
- Administrator: creates a new pending/draft version;
- published revisions cannot change category or difficulty because those fields currently live on the parent question row;
- version-associated images are copied onto the new draft revision.

---

## 14.6 Approve and publish — CURRENT

**POST** `/api/v1/admin/questions/{question_id}/publish`

Administrator only.

No request body.

Allowed only when the latest version is:

```text
review_status = pending
publication_status = draft
```

**200 response**

Returns the normal `QuestionBankDetail`, now with:

```json
{
  "review_status": "approved",
  "publication_status": "active"
}
```

The server records the Administrator as reviewer and stores the review timestamp.

When publishing a revision, the previous active version is retired before the new version becomes active, preserving the one-active-version constraint.

Invalid state:

```json
{
  "detail": "Only pending draft questions can be published"
}
```

HTTP `409`.

---

## 14.7 Reject question — CURRENT

**POST** `/api/v1/admin/questions/{question_id}/reject`

Administrator only.

Request:

```json
{
  "review_note": "Please clarify why the incorrect options are incorrect."
}
```

Rules:

- note is required;
- whitespace is trimmed;
- maximum 2000 characters;
- only a pending draft can be rejected.

**200 response**

Returns the normal `QuestionBankDetail` with:

```json
{
  "review_status": "rejected",
  "publication_status": "draft"
}
```

The rejection note is persisted but is not currently included in the detail response schema.

Invalid state:

```json
{
  "detail": "Only pending draft questions can be rejected"
}
```

HTTP `409`.

---

## 14.8 Retire question — CURRENT

**POST** `/api/v1/admin/questions/{question_id}/retire`

Administrator only.

Request:

```json
{
  "confirm": true
}
```

`confirm` must literally be `true`; false/missing values fail validation.

Successful response:

```json
{
  "question_id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  "retired_version_ids": [
    "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
  ],
  "publication_status": "retired",
  "already_retired": false
}
```

If all versions are already retired, retirement is idempotent:

```json
{
  "question_id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  "retired_version_ids": [
    "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
  ],
  "publication_status": "retired",
  "already_retired": true
}
```

A draft-only/rejected question with no active version cannot be retired:

```json
{
  "detail": "Only active published questions can be retired"
}
```

HTTP `409`.

Retirement never permanently deletes question/version records, preserving historical exam-attempt references.

---

# 15. End-to-end publication contract

The current learner-visible publication path is:

```text
Administrator creates Certification
        ↓
certification.is_published = false

Administrator creates Category
        ↓
category.is_published = false

Contributor/Admin creates Question
        ↓
pending / draft

Administrator approves + publishes Question
        ↓
approved / active

Administrator publishes Category
        ↓

Administrator publishes Certification
        ↓

GET /api/v1/categories
        ↓
Learner can discover category
        ↓

POST /api/v1/exams
        ↓
Learner can receive eligible question
```

If either the category or certification is later unpublished:

- it disappears from future learner category discovery;
- the unpublished certification contributes no new eligible question selection;
- persisted attempts and pinned historical question versions are not rewritten.

---

# 16. Screen 09 — Question review

## GET `/api/v1/exams/{attempt_id}/review` — PROPOSED

This endpoint is **not implemented**.

Current behavior:

- immediate feedback can disclose correctness/correct option IDs/explanation at per-question submit time;
- final results expose aggregate grading;
- there is no current backend route returning the complete submitted-question review payload for a completed attempt.

Any UI design that needs a full post-exam question-by-question review still requires a separate backend story.

---

# 17. Screen 10 — Attempt history

## GET `/api/v1/me/exam-attempts` — PROPOSED

This endpoint is **not implemented**.

The current backend persists attempts/results, but there is no current learner history collection endpoint.

---

# 18. Legacy/proposed catalog settings route

## PATCH `/api/v1/admin/exam-catalog/{catalog_id}/settings` — PROPOSED

This route does not exist in the current router.

The current model stores:

- `passing_threshold_pct` on the certification;
- `feedback_mode` on the certification;
- both values are snapshotted onto each new attempt.

The current JHEP-159 admin API supports these values during certification creation:

```http
POST /api/v1/admin/certifications
```

There is currently **no PATCH endpoint for editing an existing certification's threshold or feedback mode**.

A future settings-edit route should use certification scope unless the data model changes.

---

# 19. Current limits and important behavior

| Setting | Current limit / behavior |
|---|---|
| Exam question count | 1–100 |
| Selected option IDs per response | max 10 |
| Short-answer text | max 10,000 characters |
| Question rejection note | max 2,000 characters |
| Registration password | 8–128 chars + uppercase/lowercase/digit |
| Verification token lifetime | 24 hours |
| Verification resend interval | 60 seconds |
| Learner session token | dedicated learner-session TTL, default 12 hours |
| Question formats | `multiple_choice`, `short_answer` |
| Difficulty | `easy`, `medium`, `hard` |
| Feedback modes | `immediate`, `deferred` |
| Question review states | `pending`, `approved`, `rejected` |
| Question publication states | `draft`, `active`, `retired` |
| Image media types | PNG, JPEG, WebP |

---

# 20. Backend source-of-truth files

Current contract behavior is defined by:

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
backend/app/services/admin_certification_service.py
backend/app/services/admin_category_service.py
backend/app/services/question_retirement_service.py
```

When this Markdown file and the code disagree, the route decorators, Pydantic response/request models, authorization dependencies, repository eligibility rules, and service behavior above are the implementation source of truth.
