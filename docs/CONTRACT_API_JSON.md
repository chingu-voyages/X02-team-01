# JHEP — Current API Contract and Mock JSON Responses

> **Manual grading integration (JHEP-122):** Retains the JHEP-207 security
> contract and includes the manual-grading routes and learner results
> changes from `dev` at `8231527fd287`. Combined runtime verification
> remains required. See section 17 and [grading.md](grading.md).

<!-- JHEP-207 checkpoint 6F -->
> **Security update (JHEP-207):** Authentication, session revocation, MFA enrollment and Users & Access reviewed against commit `a727cd045112` (27 November 2026). See [Administrator security and onboarding](administrator-security.md). Earlier non-security sections retain their stated baselines. Local regression evidence does not certify a deployed environment.

<!-- JHEP-207 checkpoint 4D -->
> **Stabilization update (JHEP-207):** Exam deletion, question review and import catalog-confirmation sections checked against commit `0aa545138100` (27 November 2026). Earlier sections retain their original baselines. See the exam and import specifications for verification scope.

<!-- JHEP-107 exam contract update -->
> **Exam configuration update (JHEP-126/203/107):** The practice-exam route inventory and exam lifecycle sections below describe administrator-controlled publication, fixed counts and attempt isolation. See [exam-generation.md](exam-generation.md) for detailed configuration examples, error handling and verification. Other sections retain their existing baseline. This update is source-verified, not a claim of completed acceptance testing.

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

A normal Bearer token is required for protected learner content and
administrative routes. Both resolve the current database account and
compare the token issue time against `sessions_invalid_before`. Confirmed
MFA accounts also require MFA proof. Restricted enrollment and pending
challenge tokens are not full access tokens. Stateless logout is the
exception: it checks a normal JWT but does not globally revoke it.

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
| GET | `/api/v1/auth/mfa/status` | CURRENT (JHEP-109) | Full or enrollment token |
| POST | `/api/v1/auth/mfa/enroll/setup` | CURRENT (JHEP-109) | Full or enrollment token |
| POST | `/api/v1/auth/mfa/enroll/verify` | CURRENT (JHEP-109) | Full or enrollment token |
| POST | `/api/v1/auth/mfa/verify` | CURRENT (JHEP-109) | Challenge token |
| GET | `/api/v1/auth/grading-permissions` | CURRENT (JHEP-122/192) | Contributor/Admin, full session |


## 2.2 Learner discovery and delivery

| Method | Route | Status | Auth |
|---|---|---|---|
| GET | `/api/v1/categories?certification_id={certification_id}` | CURRENT | Bearer |
| GET | `/api/v1/questions` | CURRENT | Bearer |
| GET | `/api/v1/exams/catalog` | CURRENT (JHEP-126/107) | Bearer |
| POST | `/api/v1/exams` | CURRENT | Bearer |
| GET | `/api/v1/exams/{attempt_id}` | CURRENT | Bearer |
| PATCH | `/api/v1/exams/{attempt_id}/progress` | CURRENT | Bearer |
| PUT | `/api/v1/exams/{attempt_id}/responses/{question_id}` | CURRENT | Bearer |
| POST | `/api/v1/exams/{attempt_id}/responses/{question_id}/submit` | CURRENT | Bearer |
| POST | `/api/v1/exams/{attempt_id}/submit` | CURRENT | Bearer |
| GET | `/api/v1/exams/{attempt_id}/results` | CURRENT | Bearer |
| GET | `/api/v1/exams/{attempt_id}/review` | CURRENT (JHEP-37; question list only) | Bearer, attempt owner |

`{question_id}` on response routes accepts either the attempt-question addressing ID or the pinned `question_version_id`.

## 2.2A Admin — practice exam configuration and publication

| Method | Route | Status | Auth |
|---|---|---|---|
| GET | `/api/v1/admin/practice-exams` | CURRENT | Administrator |
| POST | `/api/v1/admin/practice-exams` | CURRENT | Administrator |
| GET | `/api/v1/admin/practice-exams/{exam_id}` | CURRENT | Administrator |
| PUT | `/api/v1/admin/practice-exams/{exam_id}` | CURRENT (JHEP-107) | Administrator |
| PATCH | `/api/v1/admin/practice-exams/{exam_id}/publication` | CURRENT | Administrator |
| DELETE | `/api/v1/admin/practice-exams/{exam_id}` | CURRENT (JHEP-207) | Administrator |

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
| POST | `/api/v1/admin/questions/{question_id}/submit` | CURRENT (JHEP-119) | Contributor (own draft) / Admin API* |
| POST | `/api/v1/admin/questions/{question_id}/start-review` | CURRENT (JHEP-119) | Bearer + administrator |
| POST | `/api/v1/admin/questions/{question_id}/request-changes` | CURRENT (JHEP-119) | Admin |
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
| GET | `/api/v1/admin/question-imports/{batch_id}/catalog-plan` | CURRENT (JHEP-207) | Contributor/Admin* |
| POST | `/api/v1/admin/question-imports/{batch_id}/catalog-confirm` | CURRENT (JHEP-207) | Admin |
| POST | `/api/v1/admin/question-imports/{batch_id}/commit` | CURRENT | Contributor/Admin* |
| POST | `/api/v1/admin/question-imports/{batch_id}/publish` | CURRENT | Admin |

\* Contributors can access only their own import batches. Administrators can access contributor batches.

## 2.6 Admin — users

| Method | Route | Status | Roles |
|---|---|---|---|
| GET | `/api/v1/admin/users?q=&limit=&offset=` | CURRENT | Admin |
| PATCH | `/api/v1/admin/users/{user_id}/role` | CURRENT | Admin |
| PATCH | `/api/v1/admin/users/{user_id}/grading-permissions` | CURRENT (JHEP-192) | Admin |
| GET | `/api/v1/admin/users/{user_id}/administrator-promotion` | CURRENT (JHEP-207) | Admin |
| POST | `/api/v1/admin/users/{user_id}/administrator-promotion` | CURRENT (JHEP-207) | Admin + recent MFA sign-in |

## 2.6A Admin — manual grading (JHEP-122)

| Method | Route | Status | Roles |
|---|---|---|---|
| GET | `/api/v1/admin/grading/permissions` | CURRENT | Contributor/Admin |
| GET | `/api/v1/admin/grading/pending?response_type=` | CURRENT | Contributor/Admin, permitted response types |
| GET | `/api/v1/admin/grading/responses/{attempt_id}/{question_version_id}` | CURRENT | Contributor/Admin, permitted response type |
| GET | `/api/v1/admin/grading/responses/{attempt_id}/{question_version_id}/history` | CURRENT | Contributor/Admin, permitted response type |
| POST | `/api/v1/admin/grading/responses/{attempt_id}/{question_version_id}/grade` | CURRENT | Contributor/Admin, permitted response type |

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

The older proposed `/exam-catalog` and `/admin/exam-catalog` paths are not the active configuration API. Use `/exams/catalog` and `/admin/practice-exams` instead. The completed-attempt question list is implemented under JHEP-37 (see §6.3A); individual question detail (JHEP-72) and attempt history remain separate scope.

| Method | Route | Status |
|---|---|---|
| GET | `/api/v1/exam-catalog` | PROPOSED |
| GET | `/api/v1/exam-catalog/{catalog_id}` | PROPOSED |
| PATCH | `/api/v1/admin/exam-catalog/{catalog_id}/settings` | PROPOSED |
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
administrator (enrollment required) -> /account/security
administrator (full MFA session)    -> /admin/questions
```

Logout is stateless: the client discards the JWT. It does not revoke a copied token on the server. Password reset, confirmed MFA enrollment, and administrator promotion do revoke older sessions through the account cutoff. See §3.9–3.10.

## 3.3 Password reset — CURRENT (JHEP-124)

```http
POST /api/v1/auth/forgot-password
POST /api/v1/auth/reset-password
```

Forgot-password responses are deliberately generic to avoid account enumeration.

A successful reset:

- applies the normal password policy;
- **rejects a new password identical to the account's current one** —
  verified against the stored Argon2id hash (422 `PASSWORD_UNCHANGED`;
  no plaintext comparison). A historical password-history check (the
  last N hashes) is a documented follow-up;
- invalidates access tokens and pending MFA challenges issued before the reset timestamp across protected learner and administrator routes;
- preserves confirmed MFA enrollment and recovery codes;
- does not change role/ownership.

---


## 3.9 Multi-factor authentication — enrollment — CURRENT (JHEP-109)

**Role policy:** Administrators MUST enroll before normal access;
Contributors MAY enroll; Learners are not offered new enrollment.
Once confirmed, MFA remains required at sign-in even after a role change.

A password-verified but unenrolled Administrator receives the following
login response (example):

```json
{
  "access_token": "<15-minute enrollment-only token>",
  "token_type": "bearer",
  "learner": {
    "id": "11111111-1111-4111-8111-111111111111",
    "email": "admin@example.com",
    "fullName": "Example Administrator",
    "role": "administrator",
    "is_verified": true,
    "status": "verified",
    "created_at": "2026-11-27T10:00:00Z"
  },
  "mfa_required": false,
  "mfa_enrollment_required": true,
  "challenge_id": null,
  "mfa_expires_in_seconds": 900
}
```

This JWT has `mfa: enrollment` and authorizes only the three MFA
status/setup/confirmation endpoints. Administrative requests return
403 `MFA_ENROLLMENT_REQUIRED` (under `detail`); learner content requests
reject the restricted scope with 401. Legacy full tokens for unenrolled
Administrators are also refused. The browser routes to Account Security.
After confirmation, the token is invalidated and the user must sign in
again; it is never upgraded into a full session. Ordinary unenrolled
Learners and Contributors receive a normal full token.

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
Startup is allowed without the key, but setup returns 503 and administrative onboarding/promotion cannot proceed normally. Existing MFA accounts still require MFA. Restore the correct key rather than replacing it.

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
Calling setup again invalidates the prior unconfirmed secret. Confirmed enrollment cannot be replaced via setup or confirmation; these operations return 409 `MFA_ALREADY_ENROLLED` for an already enrolled authenticated account.

### POST `/api/v1/auth/mfa/enroll/verify`

Confirms enrollment with a live six-digit code and issues recovery codes.
Request body: `{"code":"123456"}` (example). Recovery codes are shown once and stored only as SHA-256 digests. Successful confirmation invalidates prior sessions; the UI requires acknowledgement and a fresh login.

```json
{
  "message": "MFA enabled. Store your recovery codes safely — they are shown once and never again.",
  "recovery_codes": ["4F7A2B91C0", "9C31E5D8A7", "..."]
}
```

| Status | Code | When |
|---|---|---|
| 400 | `INVALID_MFA_CODE` | the code does not match |
| 422 | `VALIDATION_ERROR` | required code missing |
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
  "mfa_enrollment_required": false,
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

Success returns a full `AuthTokenOut` session with both MFA flags false and null challenge metadata. The full token carries the original password-authentication time (`iat`) and `mfa_verified_at`. Its configured lifetime defaults to 12 hours for all roles; the separate administrator-promotion freshness window is five minutes. Protected content is available according to the current role only after the required factor verification.

| Status | Code | When |
|---|---|---|
| 400 | `INVALID_MFA_CODE` | wrong, repeated, or expired code |
| 403 | `MFA_CHALLENGE_LOCKED` | configured failure limit reached (default five); new login required |
| 409 | `MFA_NOT_AVAILABLE` | enrollment or MFA configuration unavailable |
| 422 | `VALIDATION_ERROR` | required code missing |
| 401 | `INVALID_MFA_CHALLENGE` | missing or expired challenge token |

Behavioral guarantees:

- Challenge tokens carry `mfa: pending` and are rejected by both learner and administrative content guards.
- Challenges and recovery codes are consumed once; code attempts are counted per sign-in challenge.
- Password reset never bypasses MFA; the next sign-in still challenges.
- Password reset, successful MFA enrollment and administrator promotion advance the account session cutoff; older full sessions are rejected on subsequent protected requests. Older pending challenges cannot complete.
- MFA reset/replacement and recovery-code regeneration are not self-service features.
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

## 6.1 Discover and start

**GET** `/api/v1/exams/catalog`

Returns `{ "exams": [...] }`, containing only currently startable published practice exams.
Each entry includes `id`, certification/category IDs and names, `name`, `question_count`
and `available_question_count`. A successful empty catalog returns `{ "exams": [] }`.

**POST** `/api/v1/exams`

```json
{
  "practice_exam_id": "11111111-1111-4111-8111-111111111111",
  "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d",
  "category_id": "42e9c25f-4ada-5147-a894-d7fbcb0df5b7",
  "question_count": 10
}
```

- Use the exact published practice exam ID and configured count from the catalog.
- `question_count` must be a whole integer from 1–100 and within the deployment's configured maximum.
- Learner identity comes from the JWT. No learner-adjustable count or identity override is accepted.
- Legacy requests without `practice_exam_id` must uniquely match a published exam by certification, category and count. Certification-only starts are rejected by the HTTP publication gate.
- Parent certification/category must be published and valid; the certification needs a passing threshold.
- Select eligible approved/active/unflagged question versions in the selected scope, with the required answer-option configuration.
- A `201` returns the original persisted attempt ID, certification ID, status, question count and assigned questions in order.
- Only one active attempt per learner and exact published practice exam is permitted. Historical unlinked attempts retain their own scope.

Common `409` detail codes: `PRACTICE_EXAM_UNAVAILABLE`, `PRACTICE_EXAM_COUNT_MISMATCH`
(with `expected` and `received`), `INSUFFICIENT_QUESTIONS` (with `requested` and `available`),
`ATTEMPT_IN_PROGRESS` (with the original `attempt_id`), `CATEGORY_UNAVAILABLE`, and `MISSING_THRESHOLD`.
Invalid request bodies are rejected with `422`.

## 6.2 Resume/progress/answers

```http
GET   /api/v1/exams/{attempt_id}
PATCH /api/v1/exams/{attempt_id}/progress
PUT   /api/v1/exams/{attempt_id}/questions/{question_id}/flag
PUT   /api/v1/exams/{attempt_id}/responses/{question_id}
POST  /api/v1/exams/{attempt_id}/responses/{question_id}/submit
```

Submitted questions are locked. Attempt ownership is checked before retrieving saved
questions and answers. Existing question count, pinned versions, order, answers and flags
are independent of the current practice-exam configuration.

## 6.3 Complete/results

```http
POST /api/v1/exams/{attempt_id}/submit
GET  /api/v1/exams/{attempt_id}/results
```

The server-provided `passed` value is authoritative. Submitted written answers
may await manual grading. While grading is pending, `grading_complete` is
`false` and `passed` is `null`; a provisional score is not a final result.
Authorized human grading and grade revisions update the stored result.
See section 17 for the per-question breakdown. Answer keys are not returned.
Configuration changes and unpublishing do not invalidate previously persisted results.
The completed-attempt question list is available through the separate review endpoint below.

## 6.3A Completed exam question list (JHEP-37)

**GET** `/api/v1/exams/{attempt_id}/review` — authenticated attempt owner, submitted attempts only.

A `200` returns `attempt_id`, `status: "submitted"`, `question_count`, and `questions[]`.
Each question contains only `question_version_id`, original `position`, `preview` (up to 160 characters),
and `status` (`correct`, `incorrect`, `unanswered`, `pending_manual_grading`, `manually_graded`,
or `unavailable`). No answer options, learner responses, explanations, expected answers or feedback
are included. Original pinned versions and positions define the list, including questions with missing
grades. Review reads do not modify the attempt or calculate scores. A submitted attempt may still
await manual grading. The response uses `Cache-Control: no-store`.

Missing/invalid authentication returns `401`; unknown/foreign attempts return identical `404` responses;
an owned unfinished attempt returns `409`. An empty historical list is supported.

The learner route is `/exams/{attemptId}/review`, with return navigation to the same attempt's
results. JHEP-72 connects each question to its read-only detail (section 6.3B).
See [completed-exam-review.md](completed-exam-review.md) for a JSON example, status semantics,
historical integrity and verification.

## 6.3B Individual completed question review (JHEP-72)

**GET** `/api/v1/exams/{attempt_id}/review/questions/{question_version_id}` — authenticated attempt owner, submitted attempts only. Both identifiers are UUIDs; the second is the pinned version ID returned by the question list.

A `200` returns `attempt_id`, `attempt_status: "submitted"`, `question_count`,
`question_version_id`, `position`, `question_text`, `question_type`,
`allows_multiple_answers`, `question_status`, ordered `options` and `images`,
`submitted_response`, `correct_option_ids`, `explanation`, and `grading`.
The submitted response is nullable and never includes drafts. Correct option IDs
are nullable when no usable key exists or the question is written. Explanation
is nullable; grading reflects persisted outcomes and includes learner-facing
manual feedback when available, not reviewer identity or internal grading keys.

Authentication failures return `401`; unknown/foreign attempts or unassigned
versions return identical `404` responses; unfinished attempts and inconsistent
recorded detail return `409` (the latter uses `QUESTION_REVIEW_UNAVAILABLE`).
Malformed UUIDs return `422`. The route is GET-only. Success and explicitly handled
errors use `Cache-Control: no-store`. Review performs no grading or writes.

Browser route: `/exams/{attemptId}/review/questions/{questionVersionId}`.
See [individual-question-review.md](individual-question-review.md) for the JSON
example, field semantics, navigation, historical integrity and verification.

## 6.4 Administrator configuration (JHEP-107)

**PUT** `/api/v1/admin/practice-exams/{exam_id}` — Administrator only.

```json
{
  "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d",
  "category_id": "42e9c25f-4ada-5147-a894-d7fbcb0df5b7",
  "name": "Computer Science Practice",
  "question_count": 15
}
```

Full configuration update; the count is required, strictly integer and between 1 and 100.
Creation accepts a nullable/omitted count for an incomplete draft. Draft configuration can
be edited. Published exams must be unpublished first. Unpublished exams permit count changes
only; the name and catalog scope remain unchanged. Updating never changes publication status.

The `200` response is the administrator exam record, including `status`, the configured
`question_count`, and `readiness` (`ready`, `required_question_count`, `eligible_question_count`,
`issues`). A valid count with insufficient available questions may be saved, but the exam
cannot publish until readiness is satisfied. Duplicate names and disallowed changes return
`409`; invalid scope/not-found returns `404`; missing/invalid fields return `422`;
unauthenticated/non-administrator requests return `401`/`403`.

**PATCH** `/api/v1/admin/practice-exams/{exam_id}/publication` with
`{ "is_published": true }` or `{ "is_published": false }` changes availability separately.
Readiness rejection returns `409` with `detail.code = "PRACTICE_EXAM_NOT_READY"`, a message
and current readiness. New starts use the updated published configuration. Existing attempts
retain their original count, pinned questions, responses and results.

See [exam-generation.md](exam-generation.md#api-contract) for complete illustrative responses,
security and persistence behavior, and the verification matrix.

## 6.5 Safe exam deletion (JHEP-207)

**DELETE** `/api/v1/admin/practice-exams/{exam_id}` — Administrator only; no request body.

Only an unused `draft` or `unpublished` exam may be deleted. The server locks the
exam, checks for any linked learner attempt (including submitted attempts), and
deletes only the configuration. Questions, certifications and categories are not
deleted. The foreign key also prevents removing a configuration referenced by an attempt.

Successful deletion returns `204 No Content` with no JSON response body.
A missing exam returns `404`; authentication and authorization failures return `401`/`403`.
A conflict returns `409` with `detail.code` and `detail.message`:

| Code | Recovery |
|---|---|
| `PRACTICE_EXAM_PUBLISHED` | Unpublish before attempting deletion. |
| `PRACTICE_EXAM_HAS_ATTEMPTS` | Keep the exam unpublished; preserve learner history. |
| `PRACTICE_EXAM_DELETE_CONFLICT` | Refresh the list; other linked records prevent deletion. |

In the Manage Exams UI, deletion is a separate destructive action with explicit
confirmation. The record remains in the list until the server confirms success.
Protected records cannot be force-deleted through this workflow. Unpublishing blocks
new starts without erasing existing attempts or results. Historical attempts with a
null `practice_exam_id` are not inferred to belong to a particular configuration.

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
- upload, validate and explicitly commit bulk question imports;
- preview missing catalog records in their own staged batch;
- submit their own pending drafts for review;
- view/reopen only their own import history.

Cannot:

- create certifications/categories, including import catalog confirmation;
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
- bulk import questions and explicitly confirm missing catalog records;
- approve/publish eligible completed import batches;
- view all question-import history, including uploader identity;
- manage Learner/Contributor access and Contributor grading permissions;
- promote eligible Contributors through the separate recent-MFA Administrator promotion API.

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

Contributor review and administrator decisions:

```text
pending / draft → submitted / draft → in_review / draft
                                      ├─ Approve & Publish → approved / active
                                      ├─ Request Changes → pending / draft
                                      └─ Reject → rejected / inactive
```

Returned drafts may be edited and resubmitted. Rejected/inactive records are
retained and cannot be edited back into the active bank. The backend also
permits rejecting a submitted question directly; the current UI guides the
administrator through Start Review first. Administrator direct publication of
a pending draft remains supported.

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
| `review_status` | `pending`, `submitted`, `in_review`, `approved`, `rejected` |
| `publication_status` | `draft`, `active`, `inactive`, `retired` |
| `author_email` | filter author email within actor scope |
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

Authorized detail responses include `review_status`, `publication_status` and
`review_note`. Request Changes returns the question to a pending draft with
feedback; editing that draft clears the previous feedback. Rejection instead
retains an inactive, read-only record and its reason. Editing active content
is an Administrator-only revision operation, not an in-place overwrite.

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

| Action (`POST /api/v1/admin/questions/{question_id}/...`) | Allowed source | Role |
|---|---|---|
| `submit` | pending / draft | Owning Contributor; API also permits Admin |
| `start-review` | submitted | Admin |
| `request-changes` | in_review | Admin |
| `publish` | pending / draft or in_review / draft | Admin |
| `reject` | submitted or in_review | Admin |
| `retire` | existing retirement lifecycle | Admin |

Request Changes and Reject accept `{ "review_note": "Reason" }`; the reason is
required. Retirement uses `{ "confirm": true }`. The role-specific question
detail UI does not offer Submit for Review to Administrators, and exposes
Request Changes/Reject after Start Review. The API retains its existing broader
Administrator submit and direct reject capabilities. Invalid sequential state
transitions return `409`. Do not interpret UI visibility as an API permission change.

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

A structurally valid workbook can return `201` with `status = invalid` when row-level issues exist. No Question or catalog records are created at this stage.

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

Catalog records created by an earlier explicit catalog confirmation are not removed by cancelling or replacing an import.

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

## 10.8A Preview and confirm missing catalog records — CURRENT (JHEP-207)

Catalog creation is a separate, explicit operation. Upload, ordinary validation,
preview, image upload, revalidation and question commit do not create certifications
or categories automatically. Unknown required references block the question import.

### GET `/api/v1/admin/question-imports/{batch_id}/catalog-plan`

Read-only; Administrator or owning Contributor. Only active validated `invalid` or
`ready` batches are eligible for this endpoint. The server derives the proposed
additions from the stored workbook, not from editable client-provided rows.

Example response (`200`):

```json
{
  "batch_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "plan_id": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "missing_certifications": [
    { "code": "CS-100", "row_numbers": [2, 3] }
  ],
  "missing_categories": [
    { "certification_code": "CS-100", "name": "Algorithms", "row_numbers": [2] },
    { "certification_code": "CS-100", "name": "Data Structures", "row_numbers": [3] }
  ],
  "blocking_issues": [],
  "can_confirm": true
}
```

Each blocking issue contains `row_number`, `field` and `message`. Certification
codes match exactly; new codes must be uppercase. A case mismatch with an existing
certification must be corrected rather than creating another certification. Category
names match case-insensitively within the same certification; repeated references
are grouped with their workbook row numbers. Ambiguous/invalid references require
correction, not automatic guessing. `can_confirm` is false for Contributors, for an
empty plan, or when catalog-reference issues block resolution. It is not equivalent to
the batch's `can_import`: other question/image/duplicate errors may remain.

### POST `/api/v1/admin/question-imports/{batch_id}/catalog-confirm`

Administrator only. Example JSON request for the above plan:

```json
{
  "plan_id": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "confirm": true,
  "certifications": [
    {
      "code": "CS-100",
      "name": "Computer Science",
      "passing_threshold_pct": 70,
      "feedback_mode": "deferred"
    }
  ]
}
```

`plan_id` is the 64-character lowercase hexadecimal value returned by the preview;
clients must echo the current value rather than generate it. `confirm` must be a
JSON boolean and must be true to create records. Supply one configuration per
proposed new certification and no others; for a category-only plan use `[]`.
Certification name is required (1–255 characters after validation), code 1–50,
threshold a strict integer 0–100, feedback mode `immediate` or `deferred` (default
`deferred`). No category list, publication flags, or modified question rows are
accepted in the confirmation body. The server derives category creation from its plan.

The server locks the batch, coordinates category creation with existing parent-row
locks, recomputes the plan, rejects stale confirmation, and creates the confirmed
records as unpublished. Creation and batch revalidation share one transaction;
unexpected persistence/revalidation failures roll it back. A normal invalid
revalidation result is not a transaction failure: confirmed catalog records may be
created while question/image errors still block importing.

Example successful response (`200`; batch summary shown in full):

```json
{
  "batch": {
    "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "original_filename": "questions.xlsx",
    "template_version": "2.0",
    "status": "ready",
    "total_rows": 2,
    "valid_rows": 2,
    "error_rows": 0,
    "warning_rows": 2,
    "imported_rows": 0,
    "can_import": true,
    "created_at": "2026-11-27T08:00:00Z",
    "validated_at": "2026-11-27T08:02:00Z",
    "imported_at": null
  },
  "created_certification_ids": ["11111111-1111-4111-8111-111111111111"],
  "created_category_ids": [
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333"
  ]
}
```

For an invalid batch after confirmation, use the returned summary and reload rows;
`can_import` remains false. The administrator may resolve other issues and revalidate.
A successful confirmation does **not** commit questions or publish catalog content.
Confirmed catalog records persist even if the user subsequently cancels or replaces
the import. Closing the preview or declining confirmation creates nothing.

| HTTP status | Meaning |
|---|---|
| 401 | Authentication required/invalid session |
| 403 | Insufficient role for preview or confirmation |
| 404 | Batch absent or outside the actor's scope |
| 409 | Plan/state/configuration conflict; see codes below |
| 422 | Invalid confirmation request, including invalid field types |

Conflict detail has the form `{ "code": "IMPORT_CATALOG_PLAN_CHANGED", "message": "..." }`.

| Conflict code | Recovery |
|---|---|
| `IMPORT_CATALOG_CONFIRMATION_REQUIRED` | Explicitly acknowledge the reviewed additions. |
| `IMPORT_CATALOG_PLAN_CHANGED` | Fetch a new plan and require fresh confirmation. |
| `IMPORT_CATALOG_NOT_AVAILABLE` | Reopen/revalidate an active batch or correct its references. |
| `IMPORT_CATALOG_CONFIGURATION_MISMATCH` | Provide exactly the required new certification configurations. |

If a confirmation response is lost, refresh the plan and batch before retrying;
unlike question commit, replaying a previously consumed creation plan is not an
idempotent success receipt. A failed preview refresh after successful creation
does not undo catalog records. Revalidate before committing questions.

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
- read-only missing-catalog preview and Administrator-only confirmation with field validation;
- stacked responsive validation rows on smaller screens, with grouped and row-level errors;
- confirmed cancellation with temporary-asset cleanup;
- corrected-workbook replacement without leaving the page;
- read-only cancelled audit records.

The frontend does not expose an "import valid rows anyway" action.

## 10.12 Publish an imported batch — CURRENT

**POST** `/api/v1/admin/question-imports/{batch_id}/publish` — Administrator only,
separate from catalog confirmation and question commit; no request body.

Requires an `imported` batch with complete question/version provenance. Every
imported version must still be the latest version, either `pending / draft`
or `approved / active`. All versions are checked before publication; a conflict
prevents partial changes. The response contains `batch`, `requested_count`,
`published_count`, `already_published_count`, `published_question_ids`,
`already_published_question_ids` and `all_published`. Already-published versions
are counted without republishing them. The backend never publishes the parent
certification or categories as part of this action.

`409` conflict codes: `IMPORT_BATCH_NOT_IMPORTED`, `IMPORT_PUBLICATION_DATA_INVALID`,
`IMPORT_QUESTIONS_NOT_PUBLISHABLE`. Unauthorized requests return `401`/`403`;
a missing batch returns `404`. General Question Bank multi-selection is separate.

---

# 11. Admin Users & Access — CURRENT

All endpoints in this section require a full Administrator session. The
frontend is `/admin/users`; the operational onboarding sequence is in
[administrator-security.md](administrator-security.md).

## 11.1 Search accounts

**GET** `/api/v1/admin/users`

Supports `q` (email/name search), `limit` (default 50), and `offset`
(default 0). Results are ordered by email. The UI supports pagination.

```json
{
  "items": [{
    "id": "11111111-1111-4111-8111-111111111111",
    "email": "candidate@example.com",
    "fullName": "Example Candidate",
    "role": "contributor",
    "is_verified": true,
    "grade_short_answers": true,
    "grade_essays": false,
    "created_at": "2026-11-27T10:00:00Z"
  }],
  "total": 1,
  "limit": 50,
  "offset": 0
}
```

Password hashes, encrypted TOTP secrets and recovery codes are not returned.
Promotion eligibility is fetched separately for the selected account.

## 11.2 Ordinary role changes (JHEP-125)

**PATCH** `/api/v1/admin/users/{user_id}/role`

Request: `{"role":"contributor"}` or `{"role":"learner"}` only.
An actual change preserves identity, content and history and records a
role-change audit atomically. The current database role determines access
on the next protected request. A no-op does not create an audit row.
An existing browser session may still display its earlier role until
the user signs in again. This endpoint cannot grant or remove Administrator
access; self role changes are refused.

## 11.3 Written-response grading permissions (JHEP-192)

**PATCH** `/api/v1/admin/users/{user_id}/grading-permissions`

Contributor targets only. The independent optional boolean fields
`grade_short_answers` and `grade_essays` can be changed separately;
omitted or null fields keep their existing values.

Example: `{"grade_short_answers":true,"grade_essays":false}`.
A successful response includes `user` (the updated account) and `changes`
(audit metadata for changed flags: `permission`, `action`,
`previous_value`, `new_value`). Permission changes take effect on the next
protected request; existing grades are not rewritten. Administrators have
inherent grading permissions. A nonexistent target returns 404
`USER_NOT_FOUND`; a non-Contributor target returns 409 `NOT_A_CONTRIBUTOR`.

## 11.4 Administrator promotion eligibility (JHEP-207)

**GET** `/api/v1/admin/users/{user_id}/administrator-promotion`

Read-only. The actor must be a verified Administrator with a password and
usable MFA enrollment. The target must be an existing Contributor, with
verified email, a password and usable confirmed MFA. Self-promotion is
forbidden. A preview is not an authorization or reserved plan; the server
rechecks both accounts on the write request.

```json
{
  "target": {
    "id": "11111111-1111-4111-8111-111111111111",
    "email": "candidate@example.com",
    "fullName": "Example Candidate",
    "role": "contributor",
    "is_verified": true,
    "grade_short_answers": true,
    "grade_essays": false,
    "created_at": "2026-11-27T10:00:00Z"
  },
  "mfa_enrolled": true,
  "eligible": true,
  "issues": [],
  "recent_authentication": true,
  "authentication_max_age_seconds": 300
}
```

`eligible` describes target eligibility. `recent_authentication` is
independent: the actor's password and MFA timestamps must each be within
300 seconds, and the token must have been issued for an Administrator.
An eligible target can still require the actor to sign in again.
`issues` contains objects with `code` and `message`. Enrollment alone is
not proof that a stored secret is usable.

## 11.5 Explicit Administrator promotion (JHEP-207)

**POST** `/api/v1/admin/users/{user_id}/administrator-promotion`

```json
{
  "confirmation_email": "candidate@example.com",
  "confirm": true,
  "reason": "Approved administrator onboarding"
}
```

The email is trimmed and compared case-insensitively to the selected
account; it must be 1–255 characters. `confirm` must be a JSON boolean
and must be true. The trimmed reason is required, 1–1,000 characters.
Extra fields are forbidden. Do not send passwords or MFA codes to this
endpoint; reauthentication is a new ordinary password-plus-MFA login.

Successful response (200):

```json
{
  "user": {
    "id": "11111111-1111-4111-8111-111111111111",
    "email": "candidate@example.com",
    "fullName": "Example Candidate",
    "role": "administrator",
    "is_verified": true,
    "grade_short_answers": true,
    "grade_essays": false,
    "created_at": "2026-11-27T10:00:00Z"
  },
  "audit_id": "22222222-2222-4222-8222-222222222222",
  "action": "promoted",
  "role_before": "contributor",
  "role_after": "administrator",
  "changed_at": "2026-11-27T16:00:00Z",
  "previous_privileged_sessions_revoked": true
}
```

The service locks actor and target account rows in consistent order and
revalidates authorization and eligibility. Role, session cutoff and audit
record commit together; an audit-write failure rolls back the promotion.
The audit records the actor, target, before/after roles, reason and time.
Despite the historical response field name, the cutoff is also checked by
learner content routes. Prior MFA challenges cannot mint a new session.
The recipient must complete a fresh password-plus-MFA login. Administrator
demotion, initial production bootstrap and administrator-managed passwords
are outside this API.

Promotion-specific failures use `{"detail":{"code":"...","message":"..."}}`:

| HTTP | Code | Meaning |
|---|---|---|
| 401 | `ADMIN_PROMOTION_SESSION_INVALID` | Invalid or revoked actor session |
| 403 | `ADMIN_PROMOTION_FORBIDDEN` | Actor is not an Administrator |
| 403 | `ADMIN_PROMOTION_ACTOR_NOT_READY` | Actor lacks verified account/password/enrollment |
| 403 | `ADMIN_PROMOTION_REAUTH_REQUIRED` | Fresh password and MFA sign-in needed |
| 404 | `USER_NOT_FOUND` | Selected target not found |
| 409 | `ADMIN_PROMOTION_SELF` | Self-promotion refused |
| 409 | `ADMIN_PROMOTION_CONTRIBUTOR_REQUIRED` | Target is not a Contributor, including duplicate promotion |
| 409 | `ADMIN_PROMOTION_EMAIL_UNVERIFIED` | Target must verify email |
| 409 | `ADMIN_PROMOTION_PASSWORD_REQUIRED` | Target must have a password |
| 409 | `ADMIN_PROMOTION_MFA_REQUIRED` | Target must enroll |
| 409 | `ADMIN_PROMOTION_TARGET_MFA_UNAVAILABLE` | Target's MFA enrollment unusable |
| 409 | `ADMIN_PROMOTION_EMAIL_MISMATCH` | Confirmation email differs |
| 422 | `ADMIN_PROMOTION_CONFIRMATION_REQUIRED` | Explicit confirmation is false |
| 503 | `ADMIN_PROMOTION_MFA_UNAVAILABLE` | Actor/deployment MFA unusable |

The common auth dependency may return 401 or 403 before the promotion
service runs (including `MFA_ENROLLMENT_REQUIRED`). Schema validation
errors return 422 with FastAPI validation details, not necessarily a coded
promotion error. On an uncertain outcome refresh the account and preview;
do not blindly repeat the write.

---

# 12. End-to-end publication contract

```text
Administrator creates Certification and Category
        ↓
unpublished
        ↓
Contributor/Admin creates or imports Questions
        ↓
Administrator approves and publishes eligible Questions
        ↓
Administrator publishes Category and Certification
        ↓
Administrator creates a practice exam draft (Manage Exams)
        ↓
Configure name, scope and question count; validate readiness
        ↓
Administrator explicitly publishes the practice exam
        ↓
GET /api/v1/exams/catalog
        ↓
Learner sees the exact published exam and configured question count
        ↓
POST /api/v1/exams with practice_exam_id and configured count
        ↓
Learner receives pinned question versions and safe hosted image URLs
```

A published category alone does not make a practice exam available. If eligibility changes,
readiness and the learner catalog reflect the live bank; starts are revalidated by the server.

To change a published exam's count, unpublish it, save the new count, and republish after
readiness is satisfied. Configuration changes affect future attempts only. Existing attempts
retain their original assigned versions, ordering, responses, flags and results.

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
administrator (enrollment required) -> /account/security
administrator (full MFA session)    -> /admin/questions
```

Contributor Question Bank includes:

```text
Create Question
Import Questions
```

Administrator additionally has Catalog, Manage Exams (`/admin/practice-exams`) and Users & Access navigation. Learner `/categories` uses the published practice-exam catalog.

Frontend visibility does not replace backend authorization.

---

# 14. Current limits and important behavior

| Setting | Current limit / behavior |
|---|---|
| Exam question count | Administrator-configured integer 1–100; publication/start also respect the deployment maximum |
| Selected option IDs per response | max 10 |
| Short-answer text | max 10,000 characters |
| Question rejection note | max 2,000 characters |
| Registration password | 8–128 chars + uppercase/lowercase/digit |
| Verification token lifetime | 24 hours |
| Verification resend interval | 60 seconds |
| Password-reset token lifetime | 1 hour default |
| Full sign-in session token | default 12 hours (`LEARNER_ACCESS_TOKEN_HOURS`, all roles) |
| Administrator enrollment-only token | 15 minutes |
| MFA sign-in challenge | default 5 minutes; default 5 failed attempts |
| Administrator promotion authentication window | 300 seconds (password and MFA) |
| Administrator promotion reason | 1–1,000 characters after trimming |
| Question formats | `multiple_choice`, `short_answer` |
| Difficulty | `easy`, `medium`, `hard` |
| Review states | `pending`, `submitted`, `in_review`, `approved`, `rejected` |
| Publication states | `draft`, `active`, `inactive`, `retired` |
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
| Bulk commit policy | all-or-nothing question creation; separately confirmed catalog records persist |
| Bulk imported initial state | `pending / draft` |
| Raw R2/storage keys | backend-only |

---

# 15. Proposed/not-yet-implemented resources and scope

The legacy `exam-catalog` paths below are not the active configuration API; use the routes in §2.2A. The following remain unimplemented paths:

```text
GET   /api/v1/exam-catalog
GET   /api/v1/exam-catalog/{catalog_id}
PATCH /api/v1/admin/exam-catalog/{catalog_id}/settings
GET   /api/v1/me/exam-attempts
```

General Question Bank bulk selection/retirement/category changes remain separate scope. Administrator publication of an imported batch is implemented (see §10.12).

---

# 16. Backend source of truth

Current behavior is defined primarily by:

```text
backend/app/api/v1/router.py
backend/app/api/deps.py
backend/app/core/security.py
backend/app/api/v1/endpoints/auth.py
backend/app/api/v1/endpoints/admin_promotion.py
backend/app/api/v1/endpoints/categories.py
backend/app/api/v1/endpoints/questions.py
backend/app/api/v1/endpoints/exams.py
backend/app/api/v1/endpoints/admin_practice_exams.py
backend/app/api/v1/endpoints/learner_practice_exams.py
backend/app/api/v1/endpoints/admin.py
backend/app/api/v1/endpoints/question_imports.py
backend/app/api/v1/endpoints/question_import_actions.py
backend/app/api/v1/endpoints/question_import_catalog.py

backend/app/schemas/auth.py
backend/app/schemas/admin_user.py
backend/app/schemas/admin_promotion.py
backend/app/models/user.py
backend/app/models/role_change_audit.py
backend/app/services/mfa_service.py
backend/app/services/admin_user_service.py
backend/app/services/admin_promotion_service.py
backend/app/services/password_reset_service.py
backend/app/schemas/category.py
backend/app/schemas/question.py
backend/app/schemas/exam.py
backend/app/schemas/exam_review.py
backend/app/schemas/admin_practice_exam.py
backend/app/schemas/learner_practice_exam.py
backend/app/schemas/admin_question.py
backend/app/schemas/admin_certification.py
backend/app/schemas/admin_category.py
backend/app/schemas/question_import.py
backend/app/schemas/question_import_catalog.py

backend/app/models/question_import_batch.py
backend/app/models/question_import_row.py
backend/app/models/question_import_asset.py

backend/app/services/admin_practice_exam_service.py
backend/app/services/published_exam_service.py
backend/app/services/exam_service.py
backend/app/services/exam_attempt_service.py
backend/app/services/exam_review_service.py
backend/app/repositories/practice_exam_catalog_repository.py
backend/app/services/admin_question_service.py
backend/app/services/admin_question_bank_query_service.py
backend/app/services/admin_question_image_service.py
backend/app/services/question_image_validation.py
backend/app/services/question_import_parser.py
backend/app/services/question_import_validation_service.py
backend/app/services/question_import_asset_service.py
backend/app/services/question_import_commit_service.py
backend/app/services/question_import_catalog_service.py
backend/app/services/question_import_workflow_service.py
backend/app/services/question_import_publish_service.py
backend/app/services/r2_storage.py
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
Admin:        pending/draft --publish directly--> approved + active (JHEP-159's path)
```

- **Submit**: the UI offers this to the owning Contributor only; the API
  also permits Administrators under its existing actor-scope rules. The
  publication status stays `draft` — submission never publishes.
- **Opening a submission changes nothing** (AC2): only Start Review
  moves Submitted → In Review, stamped with the reviewer.
- **Request Changes** requires a reason; the reason is kept as the
  version's review feedback and the author can edit/resubmit (AC3/AC4).
- **Reject** requires a reason and the outcome is terminal:
  `publication_status: inactive` — retained, never silently reactivated
  by editing (AC4; the pre-JHEP-119 edit-reset behavior was removed).
- **Transition preconditions**: invalid sequential or repeated actions return
  409 (submit a submitted question, reject an inactive one, publish a non-draft
  source). This is not a claim of comprehensive concurrent-transition coverage.
- **The review queue**: `GET /admin/questions?review_status=submitted&author_email=…`
  or `review_status=in_review` — a single status per request, within actor scope.
- **AC7**: the review outcome, actor, timestamp and reason live on the
  question version (`review_status`, `reviewed_by_id`, `reviewed_at`,
  `review_note`). The current detail response exposes status, feedback, creator/
  submitter IDs and `last_updated`; reviewer ID and review timestamp are not
  separate detail response fields.

---

# 17. Manual grading of written responses — CURRENT (JHEP-122)

Written submissions stay `ungraded` after exam submission until an authorized
human records a final grade. All routes below require a full authenticated
Contributor or Administrator session (the JHEP-207 MFA and revocation rules
apply). Review routes re-check JHEP-192 grading permissions per response type
on every request (`view`, `history` and `grade` are equally gated).

| Route | Behaviour |
|---|---|
| `GET /api/v1/auth/grading-permissions` | Caller's effective `{short_answer, essay}` flags (Contributor/Administrator only) |
| `GET /api/v1/admin/grading/permissions` | Reviewer's own effective flags |
| `GET /api/v1/admin/grading/pending?response_type=short_answer|essay` | Submitted written responses with no final grade, filtered to permitted types; `{items, count}` |
| `GET /api/v1/admin/grading/responses/{attempt_id}/{question_version_id}` | Saved response, pinned question/rubric ceiling, expected answer, current grade, history, labelled provisional AI context |
| `GET /api/v1/admin/grading/responses/{attempt_id}/{question_version_id}/history` | Dedicated history view: `{items, count}` |
| `POST /api/v1/admin/grading/responses/{attempt_id}/{question_version_id}/grade` | Final grade/revision; body `{score: int >= 0, feedback?: string <= 5000}` |

`score` must be a whole number within the pinned rubric's `max_points`;
out-of-range values return `422 {detail:{code:"INVALID_SCORE"}}`.
Permission denials return `403 {detail:{code:"GRADING_PERMISSION_DENIED"}}`;
missing responses return `404 RESPONSE_NOT_FOUND`, and responses that are not
submitted written answers return `409 RESPONSE_NOT_GRADABLE`.

Each accepted action writes one `manual_grade_history` row with actor id/role,
action (`graded`/`revised`), score, rubric ceiling, feedback and timestamp.
Only the latest grade counts; a revision atomically updates the grade row,
attempt result, saved response state and history. `provisional_ai_feedback` is
always labelled `Provisional AI feedback — context only, not a final grade`.
The current provisional AI field is a placeholder (`available: false`);
this merge does not implement automatic AI grading.

`GET /api/v1/exams/{attempt_id}/results` now also returns
`pending_manual_grading_count` and a `questions[]` breakdown with
`status` = `graded` / `pending_manual_grading` / `unavailable`, per-question
score, rubric ceiling and human feedback. While any submitted written answer
awaits grading, `grading_complete` is `false` and `passed` is `null`; the UI
must not present a provisional score as a final pass/fail result. Unavailable
or ungraded responses are never auto-failed.
