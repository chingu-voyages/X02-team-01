# JHEP-120 — Essay response acceptance and evidence

Status: **execution / acceptance pending**. This is a test plan, not a signed-off report.
Source baseline: `feat/JHEP-120-essay-responses` at `90a8c2007e6684d0da0c1b879d11ade6f1bad0e0`.

## Scope and product decisions

The learner enters a plain-text, multiline essay, keeps drafts while navigating the
same open attempt, submits an immutable answer, and finishes the exam. Essays remain
pending until the existing manual-grading workflow returns a real grade. AI grading,
new rubric authoring, essay import, and a new authoring screen are not implemented here.

The 10,000-code-point cap is still provisional; record product-owner approval of the
maximum and permanent submission lock. Link the approved Figma frame and product-owner
acceptance before marking the ticket Done. Refresh/browser-close draft recovery is
outside this ticket; successful submitted responses must survive reload.

## Automated execution

The dedicated config has no shared demo-account global setup. Every browser test seeds
fresh local-only learner/reviewer identities, a new published catalog and four questions
(two essays, one short answer and one multiple-choice question). Question order is real,
not hard-coded. Tests use the real login screen and published-exam creation API; the
catalog-selection interface itself is not exercised by this suite.

The seeder only inserts new rows. It does not delete fixtures, reset accounts, change
credentials on existing accounts, or disable MFA. Its own generated contributor has
essay-grading permission but not short-answer-grading permission. Fixtures remain in the
disposable local DB for debugging. Repeated runs add new QA catalogs. Do not point this
workflow at a database with real learner data, even via a local proxy/tunnel.

The DB URL guard rejects remote hosts, non-PostgreSQL URLs, production-looking database
names, and connection-query host/service overrides. It cannot determine whether a local
port has been forwarded to production; the operator must confirm the target is disposable.

| Scenario | Acceptance criteria / evidence |
| --- | --- |
| Mixed journey, immediate and deferred (two cases) | Real answer persistence; essays stay neutral in either mode; no essay review queue item before Finish; one visible Finish control after out-of-order submissions; pending results; real manual grade subsequently appears. |
| Keyboard/draft navigation | Enter creates paragraphs; Tab leaves textarea; Previous, Next without submitting, numbered navigation and flags retain drafts; navigation never silently submits; mobile Escape closes disclosure and restores focus. |
| Length and Unicode | Blank and 10,001-code-point responses cannot submit; oversized text remains intact; backend rejects bypass attempts; 10,000 emoji are accepted without truncation. |
| Failed save | One injected HTTP 503 before persistence; editable original and other-question drafts survive; edited retry reaches the real backend. |
| Lost confirmation | A real server save succeeds, then its browser response is aborted; identical retry returns the original submission timestamp and stored response. DB uniqueness/concurrency are additionally covered by checkpoint 2's PostgreSQL suite. |
| In-flight guard | An explicitly gated request, not a fixed sleep, proves duplicate clicks, edits and navigation are blocked; one POST reaches the backend; focus advances only after confirmation. |
| Two-tab conflict | Two real signed-in tabs race on one question; the server response remains immutable; the conflicting local text remains selectable/copyable; another question's draft survives reconciliation. |
| Reload/plain text | Submitted paragraphs and markup-looking content reload exactly and remain read-only; text is not executed as HTML; API overwrite is rejected. |
| Authorization/isolation | Another learner cannot read/write this attempt; an unassigned version is rejected; a separate attempt using the same question keeps its own answer; learners cannot access grading. |
| Lost Finish confirmation | Real final submission followed by dropped confirmation; retry reconciles without changing results; reopening the completed attempt cannot edit, re-submit or flag answers. |

This is **11 browser cases per project**. The seven projects produce **77 planned runs**:
`chromium-desktop`, `chromium-phone`, `chromium-tablet`, `chromium-320`,
`firefox-desktop`, `webkit-desktop`, and `webkit-phone`.

The suite checks document horizontal overflow, minimum 44-CSS-pixel answer-control
target dimensions, accessible field descriptions, focus, and computed paragraph/wrapping
styles. This does not establish full WCAG conformance. Chromium narrow/tablet viewports
are layout checks; Pixel/iPhone projects emulate browser/device parameters and do not
reproduce a physical on-screen keyboard or every browser/OS behavior.

Failure injection is explicit. HTTP 503 and aborted delivery are synthetic faults around
otherwise real requests; they are not evidence of a real server outage. The source
component tests cover the unavailable-grade presentation. A grader-infrastructure outage
is not introduced or tested as part of this implementation.

## Commands (Bazzite, from the repository)

Use `sudo` for Docker only. The existing backend virtual environment supplies Python.
Stop/restart application servers after applying source changes if they were running from
another branch. The base Playwright config may reuse servers on 3030 and 8010. A stale
server is not a valid test environment.

```bash
cd "$(git rev-parse --show-toplevel)"
sudo docker compose up -d --wait postgres
cd backend
source .venv/bin/activate
alembic current
ruff check --fix scripts/seed_essay_e2e.py tests/test_seed_essay_e2e.py &&
ruff format scripts/seed_essay_e2e.py tests/test_seed_essay_e2e.py &&
ruff check . &&
ruff format --check . &&
RUN_DB_INTEGRATION=1 pytest -q tests/test_seed_essay_e2e.py
```

Expected migration includes `e120a6b4c9d2` (or a verified later descendant). No migration
is added by this checkpoint. The new backend file contains 19 fast guard checks and two
opt-in DB cases; with `RUN_DB_INTEGRATION=1`, expect all **21** to execute.

```bash
cd ../frontend
npm run lint &&
npx --no-install tsc --noEmit &&
npm test -- --run src/features/results/QuestionResultsList.essay.test.tsx

npx --no-install playwright install chromium
npx --no-install playwright test --config=playwright.essay.config.ts --list
npx --no-install playwright test --config=playwright.essay.config.ts \
  --project=chromium-desktop --project=chromium-phone
```

The desktop/phone pass contains 22 planned runs. Then run the complete matrix:

```bash
npx --no-install playwright install firefox webkit
npx --no-install playwright test --config=playwright.essay.config.ts
npx --no-install playwright show-report playwright-report/essay
```

Do not silently drop a browser project if its system dependencies are unavailable.
Record the environment failure; WebKit desktop/mobile emulation is not real iOS Safari
certification. On Bazzite, do not run copied Ubuntu package-manager commands blindly.

Before committing, run the existing regression suites as well:

```bash
npm test -- --run && npm run build
cd ../backend
RUN_DB_INTEGRATION=1 pytest -q
```

## Manual usability/accessibility acceptance

Create disposable credentials and a visible QA exam without resetting anything:

```bash
cd "$(git rev-parse --show-toplevel)/backend"
.venv/bin/python -m scripts.seed_essay_e2e --confirm-local --mode deferred
```

The JSON prints `email`, `password`, `exam_name`, and a separate authorized reviewer.
Use the learner credentials at the local login and find that exam in the normal catalog.
Do not put credential output in Jira, a commit, or a shared screenshot.

| Manual task | Pass condition | Result/evidence |
| --- | --- | --- |
| First-use navigation | A learner can find the essay, understand draft versus submitted, leave and return without losing text, then finish without instructions from the tester. | Not run |
| Physical phone, portrait and landscape | Keyboard does not cover the field/actions; long content scrolls; buttons can be tapped without accidental submission; orientation preserves the draft. | Not run |
| Browser zoom and text resizing | At 200%/400%, content and controls stay available; at 320 CSS pixels no unnecessary horizontal scrolling. Check both essay and results screens. | Not run |
| Keyboard-only journey | Visible focus throughout; Enter in the essay is a newline; Tab is not trapped; navigator Escape restores focus; confirmation leads to a usable next action. | Not run |
| Screen reader | Visible label and instructions are announced; count does not announce every keystroke; save/error/confirmation states are clear and not announced redundantly. | Not run |
| Readability/contrast | Long paragraphs are readable; disabled controls are distinguishable; status is conveyed by text, not color alone; inspect contrast and focus visibility with actual rendering. | Not run |
| Clipboard/input methods | Paste paragraphs, accents, emoji and a long URL; verify IME composition, dictated text where available, and copy from a submitted/unsent response. | Not run |
| Clear failure recovery | Turn off connectivity before submission, restore it, retry; distinguish unsent draft from locked answer. Never interpret pending/not-graded as an automatic failure. | Not run |
| Existing-question regression | A mixed exam still handles single/multiple choice, short answers, flags, deferred feedback, and results correctly. | Not run |
| Product acceptance | Confirm maximum length, immutable submission, Figma reference, and PO sign-off; record any deferred scope honestly. | Pending |

A resized desktop viewport is not sufficient evidence for the physical-phone row.
Testers should record actual device/browser/OS versions, commit, commands and outcomes.

## Evidence and ticket closure

Reports: `frontend/playwright-report/essay/`.
Screenshots, traces and videos: `frontend/test-results/essay/`.
Happy paths attach draft/submission/results screenshots; failed tests retain traces,
videos and screenshots through the inherited config. Evidence may contain generated
credentials and tokens. Inspect/redact before sharing; never commit report directories.

Record the tested commit, browser project, pass/fail/skip counts, and unresolved defects.
A skipped/failed environmental run is not a pass. Unit checks are not browser evidence.
Do not move JHEP-120 to Done until the required automated runs, manual responsive and
keyboard checks, Figma reference, and product acceptance are complete.

## References

Repository baseline and the JHEP-120 acceptance criteria supplied with this ticket are
the implementation basis. Testing practices checked against official documentation:

- Playwright projects: https://playwright.dev/docs/test-projects
- Playwright fixtures: https://playwright.dev/docs/test-fixtures
- Playwright request routing: https://playwright.dev/docs/api/class-route
- W3C reflow guidance: https://www.w3.org/WAI/WCAG22/Understanding/reflow.html
