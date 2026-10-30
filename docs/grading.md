# 🔢 Automatic MCQ Grading & Pass/Fail (JHEP-35)

> **Purpose:** scoring + Pass/Fail for submitted exam attempts.
> **For teammates:** your integration piece is in the section for your ticket.
> **Shared agreements:** see [exam-integration-contract.md](./exam-integration-contract.md).

## 📌 What exists already (this branch)

- Scoring engine: pure, fully tested — `backend/app/services/grading_service.py`
  (`compute_grades()`, `passed_at_threshold()`).
- Persistence: `exam_question_grades` (one row per assigned question version)
  and `exam_results` (one row per attempt), migration `a3b9f6c2d1e8` chained
  on `b6c2d4e091a3`; migration `cb8e51f7a6d2` adds saved responses, feedback
  modes and their attempt snapshots.
- Threshold snapshot recorded at attempt creation — no exam can be created
  for a certification without a valid 0–100 threshold (409 otherwise).
- **Response saving (JHEP-32 backend):** `exam_responses` table; the attempt
  lifecycle service `app/services/exam_attempt_service.py` saves/clears
  answers, persists navigation position and echoes saved state on resume.
- **Submission (JHEP-34 backend):** per-question submit locks a question;
  final submit freezes the attempt, stamps `submitted_at` and grades it
  exactly once (409 on duplicates; regrades are idempotent).
- **Feedback modes:** configurable per certification
  (`certifications.feedback_mode`: `immediate` | `deferred`, default
  `deferred`), snapshotted onto every attempt at creation and fixed for the
  attempt's lifetime. `immediate` releases each question's verdict,
  correct option ids and explanation at its own submit; deferred releases
  correctness only after final submission. All disclosure flows through one
  gate: `feedback_permitted(attempt, stage)`.

## 🌐 HTTP surface (all JWT-owner-checked; foreign/absent → identical 404)

| Route | Behaviour |
|---|---|
| `PATCH /exams/{id}/progress` | save navigation position (in-progress only) |
| `PUT /exams/{id}/responses/{v}` | save / update / clear one draft answer |
| `POST /exams/{id}/responses/{v}/submit` | lock the question; feedback per mode |
| `POST /exams/{id}/submit` | final submission → grading → `results_url` |
| `GET /exams/{id}/results` | aggregates + Pass/Fail; graded lazily once |

`v` is the pinned `question_version_id`. Responses are keyed
`UNIQUE (attempt_id, question_version_id)` and validated to belong to the
pinned version; empty payloads clear the draft (question counts as
unanswered). Pre-submission responses and per-question feedback never
contain `is_correct` unless disclosure is permitted.



## 👥 Integration handoffs

### JHEP-32 — backend state

Implemented in this branch: `exam_responses` (unique per
`(attempt_id, question_version_id)`), draft save/clear via
`PUT /responses/{version}`, navigation via
`PATCH /progress`, and saved-answer echo on resume (`GET /exams/{id}`,
with `is_correct` only when disclosure is permitted). The grading engine
consumes only `is_submitted = true` rows through `SavedAttemptResponses`.
Frontend integration (actual learner UI wiring) remains for the frontend
tickets.

### JHEP-34 — backend state

Implemented in this branch: per-question `POST /responses/{version}/submit`
(locks the question — further edits return 409) and final
`POST /exams/{id}/submit` (freezes the attempt, stamps `submitted_at`,
and runs the trusted grader exactly once). Duplicate final submits return
409 and create nothing; failed grading leaves the submitted attempt
readily re-renderable because `GET /results` grades idempotently.
Submission confirmation/error UX remains a frontend ticket.

### For JHEP-36 — what you read from the database (read-only)

One `exam_results` row per submitted attempt:

| Column | Meaning |
|---|---|
| `points_earned` / `points_possible` | Auto-gradable MCQ points only |
| `score_pct` | Exact percent (numeric 4 dp) — **display-only**; Pass/Fail used the unrounded fraction |
| `threshold_pct` | The pass rule **at attempt creation** (never retroactive) |
| `passed` | `true` / `false`; `NULL` = exam had zero gradable questions (no misleading score) |
| `graded_at` | When grading ran |

Per-question detail lives in `exam_question_grades`:

| Column | Meaning |
|---|---|
| `outcome` | `correct` / `incorrect` / `unanswered` / `ungraded` (short-answer) / `ungradable` (invalid key) |
| `points_earned` | 0 or 1 (no partial credit, no negative marking) |

Answer keys (`correct_option_ids`, explanations) stay outside the learner
response before submission per the feedback-mode MVP (`after_submission`).

## 🧯 Error map (for whoever surfaces grading over HTTP later)

| Condition | Meaning |
|---|---|
| Attempt not found / foreign attempt | 404 (identical body — no enumeration) |
| Question not pinned to the attempt | 404 (identical body — no enumeration) |
| Attempt still `in_progress` on results | 409 — grading disabled pre-submission |
| Attempt without threshold snapshot | 409 — historical pre-JHEP-35 attempts |
| Duplicate final submit / locked question edit | 409 — never creates duplicates |
| Save/submit with invalid selections or empty content | 422 with detail |
| Duplicate result read (regrade) | 200 — returns the stored snapshot |
| Zero gradable questions | 200 with `passed = null`, `score_pct = 0` placeholder excluded from display |

## 🧪 Run from `backend/`

```bash
ruff check .
ruff format --check .
pytest -q          # grading matrix: tests/test_grading_service.py,
                   # orchestration: tests/test_grading_orchestration.py
```
