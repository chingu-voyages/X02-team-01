# JHEP-89 — Recover an unfinished practice exam

This document describes the recovery implementation and its verification gate. It is not a claim that the final QA run has passed. The baseline is branch `feature/JHEP-89-practice-exam-recovery`, commit `df81cbce075d531104aa3f17f4e086a41efefa24`, plus the final QA files. Record the actual results on the PR.

## Learner journey

1. Sign in, open Practice exams, and select **Continue exam** under **Continue learning**. Existing attempts are independent of current publication status. A new attempt is not created by this action.
2. Continue at the last confirmed question position. Submitted answers remain locked. Unsubmitted answers are editable and are not graded by draft saving.
3. The server save indicator distinguishes saving, confirmed saved progress, and a failed save. **Save and leave** waits for queued server acknowledgements; it is not exam submission. A failed save keeps the learner on the exam.
4. Pending answer/position operations also have a best-effort device-local backup. If it exists after reopening, the recovery review shows the device copy separately from server-saved values. An eligible copy can be restored explicitly. A conflict or locked question cannot be restored over server data.
5. The learner can continue with saved progress without discarding the device copy. Discarding a copy requires confirmation and does not delete the server answer. When a save is confirmed, its pending backup is removed.

## API contract

All routes below are under `/api/v1/exams` and require a valid authenticated session. Attempt ownership is derived from the authenticated account, never a caller-supplied learner ID. Foreign and missing attempt IDs have the same `404` behavior. The catalog of new exams remains separate from existing attempts.

| Method | Route suffix | Recovery behavior |
| --- | --- | --- |
| GET | `/unfinished` | Only the caller's in-progress attempts, including historical/unpublished attempts; no questions or answer keys. |
| GET | `/{attempt_id}` | Original pinned questions, responses, lock/flag state, 1-based `current_position`, and `recovery_revision`. |
| PUT | `/{attempt_id}/responses/{question_id}` | Save or clear an unsubmitted draft. |
| PATCH | `/{attempt_id}/progress` | Persist the 1-based question position. |
| POST | `/{attempt_id}/responses/{question_id}/submit` | Submit and lock the question; correctness follows the attempt's feedback mode. |
| POST | `/{attempt_id}/submit` | Finalize the same attempt. |
| PUT | `/{attempt_id}/questions/{question_id}/flag` | Update the review flag independently of draft revisions. |

`GET /unfinished` returns `{ "attempts": [...] }`. Entries contain `attempt_id`, nullable `practice_exam_id`, `certification_name`, nullable `category_name`, nullable `name`, `question_count`, `submitted_count`, `current_position`, and `started_at`. `submitted_count` counts locked responses only. A historical attempt can lack the exact configured exam identity; no exam identity is inferred from category.

The current frontend sends `expected_revision` (non-negative integer) with each draft save, position save, question submission and final submission. For example:

```json
{"selected_option_ids": ["33333333-3333-4333-8333-333333333333"], "text_response": null, "expected_revision": 2}
```

```json
{"current_position": 3, "expected_revision": 3}
```

To clear a draft, send both answer fields as `null` with the expected revision. Written drafts are limited by the backend to 10,000 characters; leading/trailing whitespace is normalized. Submitted answers cannot be changed. The mutation response includes the server-confirmed `recovery_revision`. The frontend advances its cursor only when the expected increment is acknowledged. A revision mismatch returns HTTP `409`:

```json
{"detail": {"code": "RECOVERY_REVISION_CONFLICT", "message": "Exam progress changed elsewhere. Reload before saving again."}}
```

The server serializes competing mutations with the attempt-row lock. A clear, save, position change or submission must not use a stale revision. For backward compatibility the API still accepts omitted `expected_revision` on existing mutation routes; such legacy clients cannot modify locked answers but can replace unlocked drafts without a revision precondition. The current UI's stale-write protection is not a universal guarantee for unversioned third-party clients. Review flags do not increment this recovery revision. Invalid answer/position content returns `422`; an unavailable/unauthorized session may return `401`/`403`; a finalized attempt or locked question returns `409`.

## Local recovery and privacy

- Pending operations only, stored under `jhep.exam-recovery.v1:` with account UUID, attempt UUID and writer/snapshot identity. The journal does not store tokens, full exams or answer keys. Browser pages maintain independent snapshots.
- A successful authenticated attempt GET is required before displaying or applying a copy. The JWT subject is a namespace hint, not an authorization mechanism. Server ownership and revision checks are authoritative.
- Recovery copies are **not encrypted** and are accessible to same-origin JavaScript and a person who can inspect that browser profile. Do not use sensitive personal data in answers or assume a shared device offers private storage. The application does not automatically erase all copies on logout.
- Seven-day retention is an eligibility rule enforced during review of the corresponding attempt, not a guaranteed periodic storage purge. Corrupt records are not replayed; they may remain in storage. Clear the site data to remove all copies, understanding this also removes unacknowledged work.
- Device backup can fail due to browser policy, storage quota, unsupported APIs or storage being cleared. The server's confirmed save remains the reliable cross-device recovery mechanism. An abrupt power/process failure before durable storage is not guaranteed recoverable. Full browser restart coverage uses a clean shutdown of a temporary Chromium profile, not simulated power loss.
- Reopening while completely offline cannot authenticate and load authoritative exam content. Reconnect and sign in; the current design deliberately does not expose a cached full exam while offline.

## Acceptance criteria traceability

The Jira story requires progress persistence, recovery after refresh and browser closure, locked submitted answers, same-attempt reuse, meaningful recovery errors, no silent overwrite and ownership protection. The table maps tests to those requirements. Results are to be recorded after running them on the branch.

| Jira requirement | Verification |
| --- | --- |
| AC1: Save position, submitted answers and unsubmitted selections | `useExamAttempt.recovery.test.tsx`, `exam-navigation.e2e.ts`, final mixed restart test |
| AC1: Refresh restores saved progress | `exam-navigation.e2e.ts`, final storage-failure and mixed restart tests |
| AC1: Close browser and reauthenticate | `exam-navigation.e2e.ts` (page/context), `exam-recovery-final.e2e.ts` (actual persistent Chromium restart) |
| AC1: Submitted answers locked, correct position and no lost earlier responses | Existing navigation/state tests; final mixed restart checks original locked response and explicit draft clearing |
| AC1: Reuse exact attempt ID, no duplicate attempt | Catalog/unfinished tests, `exam-attempt-isolation.e2e.ts`, final restart returns to exact URL |
| AC2: Recover unavailable attempts with actionable error | `useExamAttempt.recovery.test.tsx`, final foreign-account UI test |
| AC2: Failed saving/recovery never silently overwrites | Revision conflict DB tests, stale mobile tab, conflicting device copy, corrupt/invalid copy, quota failure and lost-ack tests |
| AC2: Cannot read or mutate another learner's attempt | `test_exam_resume.py`, `test_unfinished_exams.py`, ownership routes, final same-profile two-account test |
| UX/mobile/accessibility | Existing navigation, flag and state tests; final 320/375/390/768 viewports; manual checks below |

## Final local verification gate

Use the isolated local database (`POSTGRES_DB=jhep89_local` when following the ticket's local setup). Do not run local fixture scripts against production. The seed helper creates a fresh bank and modifies only those newly created fixture versions before any attempt starts. The temporary persistent profile is created in the OS temp directory and removed by the test. No database reset is needed.

1. Confirm `alembic current` is the new migration head. Run `ruff check .`, `ruff format --check .` and `RUN_DB_INTEGRATION=1 python -m pytest -q` in the backend virtual environment. This runs opt-in PostgreSQL races.
2. Run all frontend Vitest tests, TypeScript, ESLint, and production build.
3. Run `npx playwright test e2e/exam-recovery-final.e2e.ts --project=chromium --workers=1 --reporter=list` (five added scenarios).
4. Run the previous six exam E2E files plus the new file (expected 21 tests), then the full repository Playwright suite. Use a fresh backend process with the isolated DB setting. Stop any old backend process running against a different database first.
5. Run `git diff --check` and review staged paths before commit. Recheck migration heads after merging any sibling migration branch (including JHEP-120).

## Manual UX and release sign-off

Record Pass/Fail/Not run, a screenshot or test reference, and any follow-up ticket for every check. Do not mark manual checks as passed based only on unit tests.

| Check | Expected result | Evidence/result |
| --- | --- | --- |
| 320, 375, 390, 768, 1024 and 1440 CSS px | No horizontal overflow; cards, navigation, comparison and exit actions fit; controls remain reachable. | Not run |
| Actual touch device and onscreen keyboard | Written answer remains reachable while typing, scrolling and rotating; no clipped controls. | Not run |
| Keyboard-only path | Login, catalog, restore/discard confirmation, question navigator and save/leave usable; focus visible and returned logically. | Not run |
| Screen reader (e.g. Orca/NVDA/VoiceOver) | Save state, error, progress, locked state and restore choices announced intelligibly; no repeated confusing announcements. | Not run |
| 200% browser zoom and contrast | Readable content, no reliance on color alone, focus not obscured; inspect actual contrast and target sizes. | Not run |
| Slow/offline network | Pending changes remain visible; save failure is explicit; retry or reconnect recovers without a duplicate attempt. | Not run |
| Expired session | No unauthorized save, no forced loss of device-backed edits; reconnect/sign in to the same account, compare device copy. | Not run |
| Browser Back, navbar, logout and tab close during pending save | Recovery after returning to the same authorized attempt; confirm warning if device backup unavailable. Save and leave remains the safest explicit action. | Not run |
| Complete and reopen an attempt | Submitted answers remain locked; results route is available; completed attempt disappears from unfinished list. | Not run |
| Shared-device privacy review | Product owner accepts unencrypted best-effort device retention or creates a security follow-up before release. | Not run |

## Deployment note

The recovery revision migration is additive and must be applied to the target database before running the new backend. No reset or destructive migration is required. If JHEP-120 merges with its own migration, resolve divergent Alembic heads in the normal integration branch; never stamp or downgrade a shared database just to make a branch run.
