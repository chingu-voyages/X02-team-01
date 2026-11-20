# JHEP-71 / JHEP-118 — Question Bank Bulk Import Contract v2

**Status:** Implemented JHEP-118 contract; final regression verification pending  
**Contract version:** 2.0  
**Prepared:** 18 November 2026  
**Implementation verified:** 19 November 2026  
**Repository baseline:** `feat/JHEP-118-bulk-question-import` through import history/audit checkpoint  
**Supersedes for implementation:** the earlier JHEP-71 contract 1.0 review draft and `question-bank-import-template-v1.xlsx`

## 1. Goal

Give TJH content authors a simple way to prepare hundreds of questions in Excel, validate the entire batch before any question-bank write, optionally attach hosted question images without exposing R2/storage details, and then create the validated batch as ordinary pending Draft questions.

The implementation must remain consistent with the existing question lifecycle:

```text
Import
  ↓
Question + QuestionVersion
  ↓
review_status = pending
publication_status = draft
is_flagged = false
  ↓
Existing review / approve / publish workflow
```

Bulk import never grants publication privileges and never overwrites existing questions.

---

## 2. User-facing format decision

### 2.1 Authoring format

The supported question-authoring format is:

```text
.xlsx
```

One question is represented by one row on a worksheet named `Questions`.

CSV is not the primary v2 authoring workflow. JSON is an internal API representation only.

### 2.2 Image delivery

Images are **not embedded inside the workbook**.

A question row may name one image file:

```text
image_filename = vpc-layout.png
```

After the workbook is uploaded, the import UI asks the user to add the referenced image files. The user never enters:

- Cloudflare R2 keys;
- database image IDs;
- CDN URLs;
- object-storage URLs;
- base64 image data.

The import workflow matches supplied files to workbook rows by normalized filename.

### 2.3 Optional future packaging

A ZIP containing the workbook and image files may be added later as a convenience transport. It is not required for contract 2.0 and must not change the underlying workbook or validation rules.

---

## 3. Workbook structure

The contract 2.0 workbook contains these worksheets:

| Worksheet | Purpose | Imported? |
|---|---|---:|
| `Read Me` | Plain-language authoring/upload instructions | No |
| `Questions` | Actual question rows; header row is row 1 | **Yes** |
| `Examples` | Worked single-select, multi-select, short-answer, math, Unicode and image examples | No |
| `Field Guide` | Definition of every column | No |
| `Sources` | Repository/source references for maintainers | No |

Only `Questions` creates question records.

---

## 4. Questions sheet — exact headers

Contract 2.0 has exactly 18 columns:

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

Column order may vary, but every header must appear exactly once.

Unknown nonblank headers, duplicate headers or missing required headers reject the workbook.

The old v1 `status` field is removed. Publication/review state is server-controlled.

---

## 5. Field contract

| Field | Required? | Contract |
|---|---|---|
| `template_version` | Required | Exact text `2.0` on every data row |
| `certification_code` | Required | Must resolve to an existing certification |
| `category_name` | Optional | If present, must resolve within the selected certification |
| `difficulty` | Required | `easy`, `medium`, or `hard` |
| `question_type` | Required | `multiple_choice` or `short_answer` |
| `allows_multiple_answers` | Required | `true` or `false`; false for short answer |
| `question_text` | Required | Nonblank Unicode text; math may use supported delimiters |
| `option_a` | Conditional | Required for multiple choice |
| `option_b` | Conditional | Required for multiple choice |
| `option_c` | Optional | Multiple choice only; no option gaps |
| `option_d` | Optional | Multiple choice only; no option gaps |
| `option_e` | Optional | Multiple choice only; no option gaps |
| `option_f` | Optional | Multiple choice only; no option gaps |
| `correct_answers` | Conditional | MC only; letters `A`–`F`, separated by `;` |
| `expected_answer` | Conditional | Short answer only |
| `explanation` | Optional | Learner feedback/explanation |
| `image_filename` | Optional / paired | Basename of one image file supplied to the import batch |
| `image_alt_text` | Required with image | Meaningful alt text for the referenced image |

---

## 6. Server-controlled fields

The workbook cannot control any of these:

| Field | Required behavior |
|---|---|
| `questions.id` | Generate server-side |
| `question_versions.id` | Generate server-side |
| answer/image/key IDs | Generate server-side |
| `created_by_id` | Authenticated importing user |
| `submitted_by_id` | Authenticated importing user |
| `version_number` | `1` for imported new questions |
| `review_status` | `pending` |
| `publication_status` | `draft` |
| `is_flagged` | `false` |
| review fields | Null until existing review workflow acts |
| timestamps | Server-generated |

A workbook cannot request `approved`, `active`, `published`, or `retired`.

---

## 7. Workbook safety rules

The server validates workbook structure before row validation.

### Required

- `.xlsx` authoring file.
- Visible `Questions` sheet.
- Exactly one header row at row 1.
- All 18 contract headers exactly once.
- No unknown nonblank headers.
- Fully blank rows are ignored.
- Header-only workbook returns `EMPTY_IMPORT`.

### Rejected

- malformed OOXML;
- password-protected/encrypted workbook;
- macro-enabled workbook;
- Excel formulas in imported cells;
- external workbook links/data connections;
- merged cells in `Questions`;
- hidden data rows or hidden import columns;
- active filters concealing data;
- embedded images/media/objects;
- data outside the declared contract columns.

### Initial resource limits

- maximum workbook upload: **5 MiB**;
- maximum nonblank question rows: **1,000**;
- parsing must use bounded decompression/package-entry limits;
- expensive parsing happens only after authentication and basic size/type checks.

These limits may become configurable, but changing them does not change the template contract.

---

## 8. Text, Unicode and math

For textual question fields:

1. normalize Unicode to NFC;
2. normalize CRLF/CR line endings to LF;
3. trim outer whitespace;
4. preserve internal whitespace, case, accents, scripts and math symbols;
5. reject NUL/disallowed control characters;
6. never silently replace undecodable text.

Math remains part of the question text rather than a separate database field.

Supported authoring convention:

```text
Inline:  Solve \(2x + 4 = 10\).
Display: \[a^2 + b^2 = c^2\]
```

Validation checks supported delimiter pairing. It does not execute or evaluate TeX.

Math-bearing questions must be rendered in the import preview using the application's learner-facing rendering path before confirmation.

---

## 9. Question-type validation

### 9.1 Multiple choice

Require:

- 2–6 contiguous options from A onward;
- at least one correct answer;
- `correct_answers` references only supplied options;
- no repeated answer letters;
- no option gaps;
- no exact duplicate option text after the normal text normalization.

When `allows_multiple_answers=false`, exactly one answer is correct.

When `allows_multiple_answers=true`, one or more answers may be correct.

`expected_answer` must be blank.

### 9.2 Short answer

Require:

- `allows_multiple_answers=false`;
- nonblank `expected_answer`;
- all option columns blank;
- `correct_answers` blank.

Importing a short-answer Draft does not introduce a new grading strategy. Surface the existing short-answer grading limitation as a warning in preview when applicable.

---

## 10. Catalog validation

`certification_code` resolves to an existing certification.

`category_name`, when present, resolves only inside that certification.

The importer never auto-creates:

- certifications;
- categories;
- publication state.

Blocking issues include:

```text
CERTIFICATION_NOT_FOUND
CATEGORY_NOT_FOUND
AMBIGUOUS_CATALOG_REFERENCE
CATEGORY_CERTIFICATION_MISMATCH
```

Blank category is allowed if the existing question model permits it. Surface `CATEGORY_MISSING` as a warning because the learner journey is category-oriented.

Unpublished catalog records may receive Draft questions but should surface `CATALOG_UNPUBLISHED`.

---

## 11. Image contract

### 11.1 Current capability

The current application supports hosted question images with:

- PNG;
- JPEG;
- WebP;
- required alt text;
- file-byte validation;
- configured byte and decoded-pixel limits;
- version-pinned metadata;
- current MVP limit of **one image per question version**.

Bulk import reuses those same validation rules. It must not implement a competing image policy.

### 11.2 Workbook representation

Question without image:

```text
image_filename = blank
image_alt_text = blank
```

Question with image:

```text
image_filename = vpc-layout.png
image_alt_text = Diagram showing public and private subnets in an AWS VPC.
```

Both fields are paired.

### 11.3 Filename matching

For matching purposes:

- use the basename only;
- trim outer whitespace;
- normalize filename Unicode to NFC;
- compare case-insensitively for user friendliness;
- preserve the original supplied filename for display/audit;
- if two uploaded files collapse to the same normalized filename, raise `DUPLICATE_IMAGE_FILENAME`.

Path separators in `image_filename` are rejected. The workbook must not name directories.

### 11.4 Allowed reuse

One uploaded image file may be referenced by multiple question rows.

The importer may store a single immutable R2 object and safely reference it from more than one `question_images` row, provided normal deletion/reference safety is preserved.

### 11.5 Image validation errors

Blocking examples:

```text
MISSING_IMAGE_FILE
IMAGE_ALT_TEXT_REQUIRED
IMAGE_ALT_TEXT_WITHOUT_IMAGE
INVALID_IMAGE_TYPE
INVALID_IMAGE_CONTENT
IMAGE_TOO_LARGE
IMAGE_DIMENSIONS_TOO_LARGE
DUPLICATE_IMAGE_FILENAME
EMBEDDED_IMAGE_NOT_ALLOWED
```

An uploaded image not referenced by any row is a warning:

```text
UNUSED_IMAGE_FILE
```

### 11.6 No storage leakage

Import responses and frontend previews return safe media metadata/preview URLs only.

Never expose:

- R2 credentials;
- raw storage keys in public/learner payloads;
- signed write URLs to the browser.

---

## 12. Duplicate question policy

Contract 2.0 creates **new questions only**.

It never:

- updates an existing Draft;
- edits a rejected question;
- creates a revision of an active question;
- merges answers;
- silently skips a duplicate.

Duplicate identity is:

```text
(
  certification_id,
  category_id_or_null,
  question_type,
  normalized_question_text
)
```

`normalized_question_text` uses the same content normalization as import text: NFC, normalized line endings and outer trim. Do not remove punctuation, math markup, case, or meaningful internal spacing.

Detect:

```text
DUPLICATE_IN_FILE
DUPLICATE_IN_BANK
```

Duplicate checking occurs both during validation and again immediately before commit.

Semantic/fuzzy duplicate detection is outside this contract.

---

## 13. Batch and retry policy

Every upload creates or identifies an import batch containing:

- import ID;
- actor;
- contract version;
- original workbook name;
- exact workbook SHA-256;
- state;
- validation receipt;
- row issues/warnings;
- image-asset metadata;
- created question/version IDs after success.

A successful identical workbook must not be imported twice accidentally.

Required behaviors:

- repeated confirmation of a completed import returns the existing authorized receipt or an already-imported result;
- concurrent confirmations cannot create two copies;
- validation receipt is bound to the actor and immutable uploaded content;
- commit rechecks authorization, catalog state, duplicates and validation freshness;
- invalid/rolled-back attempts do not block a corrected workbook.

---

## 14. All-or-nothing behavior

A blocking file, row, duplicate, image, permission, or commit-time validation issue means:

```text
can_import = false
persisted_questions = 0
```

There is no "import valid rows anyway" action in contract 2.0.

Warnings do not make the batch invalid but must be visible before confirmation.

If anything fails during confirmed persistence, the entire question batch transaction rolls back.

Image/object-storage cleanup must also be safe: failed imports must not leave question records pointing at missing objects, and uploaded temporary objects must be cleaned up or safely recoverable.

---

## 15. Error and warning contract

Every issue contains:

| Field | Meaning |
|---|---|
| `sheet` | `Questions`, or null for whole-file/asset issues |
| `row` | 1-based workbook row; null for file-level issues |
| `field` | Contract field name; null for file-wide issues |
| `cell` | Original A1 cell address when applicable |
| `severity` | `error` or `warning` |
| `code` | Stable machine-readable code |
| `message` | Actionable user-facing correction |
| `value_preview` | Optional escaped short preview |
| `related_rows` | Related physical rows for duplicates |
| `asset_filename` | Relevant image filename for image issues |

Do not expose:

- stack traces;
- raw database errors;
- another contributor's private answer configuration;
- inaccessible question IDs.

---

## 16. Validation preview

The implemented UI shows a readable batch summary before confirmation.

Current summary counts include:

```text
Total
Ready
Errors
Warnings
```

The preview currently allows the user to:

- view all staged rows;
- filter rows to `Ready` or `Needs Attention`;
- see the original physical Excel row number;
- see question text, certification, category, type and image filename;
- see actionable row issues with stable error/warning codes;
- see missing image filenames;
- upload referenced PNG/JPEG/WebP files;
- trigger automatic revalidation after image upload;
- confirm only when there are no blocking errors.

Current image workflow example:

```text
3 Questions

1 Ready
2 Errors

Missing:
segmented-network.png
mfa-login-flow.png

Upload both files
        ↓
3 Ready
0 Errors
        ↓
Import 3 Questions
```

Blocking errors produce an explicit `Import blocked` state and no partial-import action.

A richer learner-renderer preview of the fully formatted question/options/math/media is a future UX enhancement and is not required by the implemented JHEP-118 acceptance path.

---

## 17. Confirmation

Clean validation:

```text
500 valid questions will be created as Drafts.
17 referenced images are matched and validated.
12 warnings were reviewed.

[Cancel] [Import 500 Questions]
```

Confirmation must be explicit.

The client sends only the import/validation identifier. It must not be able to replace the already-validated question rows in the confirmation request.

---

## 18. Successful result

A successful import reports:

- created Draft count;
- import ID;
- actor;
- completion time;
- created question IDs or an authorized link/filter for the batch;
- warning count;
- image count.

Imported questions immediately become visible in the authorized Question Bank and enter the existing review workflow.

---

## 19. Authorization

For JHEP-118:

```text
Administrator  → may bulk import
Contributor    → may bulk import; imported questions belong to that contributor
Learner        → forbidden
Anonymous      → authentication required
```

Bulk import does not grant an importing Contributor any Administrator-only review, approval, publication or retirement ability.

---

## 20. Question Bank integration

The import feature and Question Bank scale work are intentionally related.

The implemented Question Bank now uses server-side search/filtering/pagination and supports:

- search text;
- certification;
- category;
- difficulty;
- question type;
- review status;
- publication status;
- image presence;
- page/page size.

Imported questions are immediately visible to the authorized manager as ordinary:

```text
review_status = pending
publication_status = draft
```

Import provenance is retained through:

```text
QuestionImportBatch
    ↓
QuestionImportRow
    ↓
created_question_id
created_question_version_id
```

The current JHEP-118 UI exposes that provenance through **Recent Imports** and the ability to reopen a batch.

Question Bank filtering directly by `import_batch_id` and owner, plus multi-select/batch management actions, remain separate management scope after JHEP-118.

---

## 21. Implementation status

Implemented for JHEP-118:

1. contract/template v2;
2. scalable Question Bank query API;
3. scalable Question Bank frontend;
4. import batch/row/asset staging models + Alembic migration;
5. XLSX parser and normalized image filename matching;
6. validation, duplicate detection and row-level issue persistence;
7. workbook upload + validation-preview API;
8. R2-backed import image staging + automatic batch revalidation;
9. atomic all-or-nothing Draft persistence;
10. import frontend workflow;
11. Recent Imports history/audit + reopen/continue behavior;
12. API/configuration/spec documentation.

Final acceptance verification is performed as three explicit gates:

```text
Unit tests
    ↓
Integration tests
    ↓
Browser E2E tests
```

Question Bank batch actions such as bulk approve/publish/retire/category changes are intentionally deferred to separate scope.

---

## 22. Out of scope for contract 2.0

- CSV as a second authoring contract;
- embedded Excel images;
- image URLs/storage keys supplied by authors;
- more than one image per question version;
- automatic certification/category creation;
- automatic approval or publication;
- updating/upserting existing questions through import;
- fuzzy/AI duplicate detection;
- formula execution;
- full TeX correctness checking;
- new short-answer grading behavior;
- Google Sheets synchronization;
- background queue infrastructure unless measured upload limits require it.

---

## 23. Current implementation source files

The implementation reuses the existing question/image lifecycle and adds dedicated import components:

```text
backend/app/api/v1/endpoints/question_imports.py
backend/app/schemas/question_import.py

backend/app/models/question_import_batch.py
backend/app/models/question_import_row.py
backend/app/models/question_import_asset.py

backend/app/services/question_import_parser.py
backend/app/services/question_import_validation_service.py
backend/app/services/question_import_asset_service.py
backend/app/services/question_import_commit_service.py

backend/app/services/admin_question_service.py
backend/app/services/admin_question_bank_query_service.py
backend/app/services/admin_question_image_service.py
backend/app/services/question_image_validation.py
backend/app/services/r2_storage.py

frontend/src/app/admin/questions/page.tsx
frontend/src/app/admin/questions/import/page.tsx
frontend/src/lib/question-import-api.ts
frontend/src/types/question-import-api.types.ts
frontend/src/lib/api-client.ts
```

`admin_question_service.py` now exposes a transaction-neutral draft-add helper used by the atomic importer while preserving the existing single-question creation endpoint's normal commit behavior.

---

## 24. Template artifact

Contract 2.0 is paired with:

```text
docs/question-import/question-bank-import-template-v2.xlsx
```

The frontend serves the same approved template from:

```text
frontend/public/templates/question-bank-import-template-v2.xlsx
```

The workbook contains the exact 18-column contract and worked examples for single-select MCQ, multi-select MCQ, short answer, math, Unicode and image-backed questions.

Image files are intentionally supplied separately through the import UI rather than embedded in the workbook.

---

## 25. Implemented API workflow

Current JHEP-118 routes:

```text
GET  /api/v1/admin/question-imports
POST /api/v1/admin/question-imports

GET  /api/v1/admin/question-imports/{batch_id}
GET  /api/v1/admin/question-imports/{batch_id}/rows

POST /api/v1/admin/question-imports/{batch_id}/assets
POST /api/v1/admin/question-imports/{batch_id}/commit
```

Current batch lifecycle:

```text
uploaded
   ↓
validating
   ↓
invalid ── upload missing image(s) ──┐
   ↓                                │
ready ◀─────────────────────────────┘
   ↓
importing
   ↓
imported
```

Contributor scope:

```text
own uploads only
```

Administrator scope:

```text
all uploads + uploader identity in history
```

Successful commit is atomic and creates only new `pending / draft` questions. Existing approved/published questions are never overwritten.
