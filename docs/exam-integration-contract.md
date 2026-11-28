# 🔗 Exam Flow Integration Contract (JHEP-32 / 34 / 35 / 36)

> **Scope:** Written agreements between the four exam-flow tickets so features
> connect without merge conflicts or schema surprises.
> **Owner:** JHEP-35 (grading) proposes; teammates confirm or veto in standup.
> **Status:** ✅ Agreed at team standup — recorded here per ticket ownership.

## 📌 Learner journey

```
CREATE exam (29 ✅) → ANSWER & LOCK questions (32) → FINISH: submit once (34)
                   → GRADE multiple-choice + Pass/Fail (35) → SHOW results (36)
```

## 🟢 Decision 1 — Attempt status stays `submitted`

- `exam_attempts.status` uses exactly `in_progress` | `submitted` (existing DB constraint).
- **JHEP-34's "marked as completed" means:** `status = 'submitted'` **AND** `submitted_at` set.
- No new status values are added to the database.
- UI copy may display the word "Completed" — stored values may not change.

## 🟢 Decision 2 — Pending selections score 0

- JHEP-32 keeps unsubmitted selections remembered (for navigation/resume), but they
  are **not answers**.
- At final submission, unanswered questions (no submitted response) score **0 points**.
- **JHEP-34 adds a pre-finish confirmation:** "You have N unsubmitted answers —
  submit anyway?" — this is the UX mitigation for the strict scoring rule.

## 🟢 Decision 3 — Grading runs synchronously at finalization (JHEP-35 owns it)

- JHEP-34's submit flow flips the attempt to `submitted`, then calls
  `GradingService.grade_attempt(attempt_id)`.
- Grading is **idempotent**: regrading a submitted attempt (duplicate submit, retry)
  returns the stored result; no duplicate scoring records are ever created.
- **JHEP-36 reads stored scores only** — it never computes anything and never reads
  answer keys directly.

## 🗄️ Stored data contracts

### Answers — owned by JHEP-32 (proposed shape)

Table `exam_responses`, one row per **locked-in** answer:

| Column | Notes |
|---|---|
| `attempt_id` | FK → `exam_attempts.id` |
| `question_version_id` | FK → `question_versions.id` (pinned version, never re-resolved) |
| `question_id` | Mirror of the parent question |
| `position` | Display position 1..N within the attempt |
| `selected_option_ids` | JSONB list of option UUIDs |
| `is_submitted` | Only `true` rows are learner answers |
| `answered_at` | Timestamp |

- `UNIQUE (attempt_id, question_version_id)` — one answer per question per attempt.
- Detection of "unanswered": question in `exam_attempt_questions` with no
  `is_submitted = true` row.

### Thresholds — owned by JHEP-35 (this contract's version)

- `certifications.passing_threshold_pct` — 0–100, set by the backend/DB admin path.
- `exam_attempts.passing_threshold_pct` — snapshot recorded **at attempt creation**
  (JHEP-29's `create_exam` copies + validates it).
- Later threshold changes never affect existing attempts (AC3 evidence is per-attempt).
- An exam cannot be created for a certification without a configured threshold (409).

### Scoring — owned by JHEP-35

Tables `exam_results` (one per attempt) and `exam_question_grades` (one per
assigned question version). See `docs/grading.md` (pending) for full semantics.

## 🛡️ Security rules shared by all tickets

- Ownership checked before any read of attempt data; foreign/nonexistent
  attempts return an identical 404.
- Answer keys (`is_correct`, `expected_answer`, explanations) never reach a
  learner before submission.
- CRUD belongs to service layers; endpoints map errors to HTTP codes only.

## 🧩 Change requests

Teammates propose changes to this contract via a comment in the PR that
modifies it. Once a PR merges, the contract is binding for dependent work.
