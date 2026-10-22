# Practice Exam Question Schema

**For:** Store and organise practice exam question
**Paired with:** Retrieve approved practice question
**Source:** `Untitled-2026-10-20-2102.excalidraw` (ER diagram), with the decisions in §8

---

## 1. Overview

Questions are **versioned**. `questions` holds the stable identity of a question
and the facts that do not change between revisions (certification, category,
difficulty, author). Everything editable — text, type, options, answer key,
review outcome, publication state — lives on a `question_versions` row.

```
certifications 1 ──< categories 1 ──< questions 1 ──< question_versions
                     users 1 ──< questions
                     users 1 ──< question_versions   (submitted_by / reviewed_by)
question_versions 1 ──< answer_options
question_versions 1 ──< text_answer_keys
```

All foreign keys use Postgres' default `NO ACTION`; there is no `ON DELETE
CASCADE`. A question with versions cannot be deleted until its versions are
removed explicitly.

---

## 2. Tables

### `certifications`

| column | type         | null | notes                             |
|--------|--------------|------|-----------------------------------|
| `id`   | uuid         | no   | PK, generated in Python           |
| `name` | varchar(255) | no   | example: `'<Certification Name>'` |
| `code` | varchar(50)  | no   | unique — `'<CODE>'`               |

> **No certification may be hardcoded.** Adding one is a row insert, not a
> deployment. No code may branch on or compare against a specific certification's
> `id`, `name` or `code`. Seed data is ordinary rows; deleting them must leave the
> app working. Check: `grep -rniE "scrum|csm" backend/app frontend/src` must be empty.

### `users`

| column       | type         | null | notes                   |
|--------------|--------------|------|-------------------------|
| `id`         | uuid         | no   | PK, generated in Python |
| `email`      | varchar(255) | no   | unique                  |
| `created_at` | timestamptz  | no   | default now()           |

> This is a minimal table so the authorship FKs have a target. The full user
> model remains the auth team's scope.

### `categories`

| column             | type         | null | notes                    |
|--------------------|--------------|------|--------------------------|
| `id`               | uuid         | no   | PK                       |
| `certification_id` | uuid         | no   | FK → `certifications`    |
| `name`             | varchar(255) | no   |                          |

```
UNIQUE (certification_id, name)
UNIQUE (certification_id, id)
```

The second unique constraint exists solely to support the composite foreign key
on `questions` (see §8.1).

### `questions`

| column             | type         | null | notes                                       |
|--------------------|--------------|------|---------------------------------------------|
| `id`               | uuid         | no   | PK                                          |
| `certification_id` | uuid         | no   | FK → `certifications`                       |
| `category_id`      | uuid         | **yes** | FK → `categories`                        |
| `difficulty`       | varchar(20)  | no   | CHECK, see §3                               |
| `created_by_id`    | uuid         | no   | FK → `users`                                |
| `created_at`       | timestamptz  | no   | default now()                               |

```
FOREIGN KEY (certification_id, category_id)
    REFERENCES categories (certification_id, id)
```

A question always belongs to a certification. A category is optional. When a
category is set it must belong to the same certification: the composite FK makes
that impossible to violate, replacing what would otherwise be an unenforceable
"two independent paths must agree" rule.

With the default `MATCH SIMPLE` semantics, a `NULL` `category_id` means the
composite FK is not checked — the question is still certified, just uncategorised.

### `question_versions`

| column                   | type          | null | notes                                           |
|--------------------------|---------------|------|-------------------------------------------------|
| `id`                     | uuid          | no   | PK                                              |
| `question_id`            | uuid          | no   | FK → `questions`                                |
| `version_number`         | int           | no   | 1-based; `UNIQUE (question_id, version_number)` |
| `question_text`          | text          | no   | non-blank                                       |
| `question_type`          | varchar(32)   | no   | CHECK, see §3                                   |
| `allows_multiple_answers`| boolean       | no   | default `false`; multiple-choice only           |
| `explanation`            | text          | yes  | shown after submission                          |
| `review_status`          | varchar(20)   | no   | default `pending`                               |
| `publication_status`     | varchar(20)   | no   | default `draft`                                 |
| `is_flagged`             | boolean       | no   | default `false`                                 |
| `submitted_by_id`        | uuid          | no   | FK → `users`                                    |
| `submitted_at`           | timestamptz   | no   | default now()                                   |
| `reviewed_by_id`         | uuid          | yes  | FK → `users`                                    |
| `reviewed_at`            | timestamptz   | yes  |                                                 |
| `review_note`            | text          | yes  |                                                 |

There is no separate `created_at`/`updated_at` on versions: `submitted_at` and
`reviewed_at` cover the audit trail.

### `answer_options`

| column                | type    | null | notes                                    |
|-----------------------|---------|------|------------------------------------------|
| `id`                  | uuid    | no   | PK                                       |
| `question_version_id` | uuid    | no   | FK → `question_versions`                 |
| `position`            | int     | no   | `UNIQUE (question_version_id, position)` |
| `option_text`         | text    | no   | non-blank                                |
| `is_correct`          | boolean | no   | default `false`                          |

### `text_answer_keys`

| column                | type | null | notes                    |
|-----------------------|------|------|--------------------------|
| `id`                  | uuid | no   | PK                       |
| `question_version_id` | uuid | no   | FK → `question_versions` |
| `expected_answer`     | text | no   | non-blank                |

The answer key for short-answer questions lives **only** here. There is no inline
`expected_answer` column on `question_versions`.

---

## 3. Controlled vocabularies

These are `varchar` columns with `CHECK` constraints (not Postgres enum types):

| column               | allowed values                    |
|----------------------|-----------------------------------|
| `questions.difficulty` | `easy`, `medium`, `hard`        |
| `question_type`      | `multiple_choice`, `short_answer` |
| `review_status`      | `pending`, `approved`, `rejected` |
| `publication_status` | `draft`, `active`, `retired`      |

---

## 4. Constraints

### 4.1 Database-enforced

- `UNIQUE (certification_id, name)` on `categories`
- `UNIQUE (certification_id, id)` on `categories` (composite-FK target)
- `UNIQUE (question_id, version_number)` on `question_versions`
- `UNIQUE (question_version_id, position)` on `answer_options`
- `UNIQUE (question_id) WHERE publication_status = 'active'` on
  `question_versions` — at most one active version per question
- `questions.difficulty IN ('easy', 'medium', 'hard')`
- `question_versions.version_number > 0`
- `question_versions.question_type IN ('multiple_choice', 'short_answer')`
- `NOT allows_multiple_answers OR question_type = 'multiple_choice'`
- `question_versions.review_status IN ('pending', 'approved', 'rejected')`
- `question_versions.publication_status IN ('draft', 'active', 'retired')`
- `publication_status != 'active' OR review_status = 'approved'`
- `length(trim(question_text)) > 0`
- `review_status = 'pending' OR (reviewed_by_id IS NOT NULL AND reviewed_at IS NOT NULL)`
- `answer_options.position > 0`
- `length(trim(option_text)) > 0`
- `length(trim(expected_answer)) > 0`
- Composite `(certification_id, category_id) → categories(certification_id, id)`

### 4.2 Service-layer (cannot be a CHECK — these span rows)

- `multiple_choice` version has **≥ 2** `answer_options`
- `multiple_choice` version has **≥ 1** correct option
- single-select (`allows_multiple_answers = false`) has **exactly 1** correct option
- `short_answer` version has **exactly 1** `text_answer_keys` row
- `multiple_choice` has **0** `text_answer_keys`; `short_answer` has **0** `answer_options`
- `version_number` is assigned by the service, never the client

Multi-select is allowed: when `allows_multiple_answers = true`, more than one
option may be correct. There is deliberately **no** partial unique index on
`answer_options.is_correct`.

---

## 5. Retrieval contract

`GET /api/v1/questions` (JWT required) returns:

```
{"items": [...], "count": N}
```

A version is eligible when **all** of these hold:

- `review_status = 'approved'`
- `publication_status = 'active'`
- `is_flagged = false`

Pending, rejected, draft, retired and flagged versions are excluded.

Each item carries `question_type` and `allows_multiple_answers` so clients can
render single- versus multi-select. The response must never contain `is_correct`,
`expected_answer`, review details, publication state or `is_flagged` before
submission. The service maps domain objects onto response models that omit those
fields.

The MVP returns **all** eligible versions across all certifications; certification
filtering is not part of this ticket. Clients filter downstream.

An empty bank is not an error: `200` with `{"items": [], "count": 0}`.

---

## 6. Acceptance criteria → column

### Store and organise

| criterion                                    | column(s)                                             |
|----------------------------------------------|-------------------------------------------------------|
| Multiple-choice and short-answer formats     | `question_type`, `answer_options`, `text_answer_keys` |
| Single- and multi-select                     | `allows_multiple_answers`, `answer_options.is_correct` |
| Certification / topic                        | `certifications`, `categories`, `questions.certification_id`, `questions.category_id` |
| Question text                                | `question_text`                                       |
| Answer configuration                         | `answer_options.{position,option_text,is_correct}`, `text_answer_keys.expected_answer` |
| Review / publication status                  | `review_status`, `publication_status`, `is_flagged`   |
| Additional certifications without hardcoding | `certifications` table; no certification-specific code (§2) |

### Retrieve approved

| criterion                                 | column(s)                                                                          |
|-------------------------------------------|------------------------------------------------------------------------------------|
| Approved, active, unflagged               | `review_status='approved'` AND `publication_status='active'` AND `is_flagged=false` |
| Pending, rejected excluded                | `review_status`                                                                    |
| Retired excluded                          | `publication_status='retired'`                                                     |
| No answer key pre-submission              | omit `text_answer_keys.expected_answer`, `answer_options.is_correct`               |
| Empty state                               | `{"items": [], "count": 0}` with `200`                                              |

---

## 7. Agreed field names

| concept                | column                      |
|------------------------|-----------------------------|
| eligibility: approved  | `review_status`             |
| eligibility: active    | `publication_status`        |
| eligibility: unflagged | `is_flagged`                |
| answer key (choice)    | `answer_options.is_correct` |
| answer key (text)      | `text_answer_keys.expected_answer` |
| question text          | `question_text`             |
| multi-select           | `allows_multiple_answers`   |

---

## 8. Decisions and rationale

### 8.1 Kept `questions.certification_id` with a composite FK

The easier design drops `certification_id` from `questions` and reaches
certification through `categories`. That has one source of truth but makes
certification **unreachable for uncategorised questions** and cannot express
"certification A, no category yet".

Keeping both columns would normally allow them to disagree. The composite FK
`(certification_id, category_id) → categories(certification_id, id)` removes that
risk in the database: a category always belongs to the question's certification.
With `category_id` nullable, the question must still name its certification, and
`MATCH SIMPLE` skips the composite check when the category is `NULL`.

### 8.2 Added `is_flagged`

The retrieve AC requires "unflagged". The diagram had no such column, so the
filter would be unsatisfiable. It lives on the version, next to `review_status`,
since both are editorial signals that can change per revision.

### 8.3 `publication_status` instead of `is_published BOOLEAN`

`draft`, `active`, `retired`. A boolean collapses *never-published* and *retired*
into the same `false`, so "retired is excluded" becomes indistinguishable from
"drafts are excluded". The status also makes the partial unique index
(one active version per question) expressible.

### 8.4 CHECK constraints

Added answer-key/type agreement, publication-requires-approval, non-blank text,
positive ordering/version numbers and review-audit integrity. The diagram's
columns implied these invariants but nothing enforced them.

### 8.5 Answer keys stay in `text_answer_keys`; `explanation` added

The multiple-choice key is `answer_options.is_correct`. Short-answer keys live in
`text_answer_keys`, matching the diagram. No inline `expected_answer` column was
added to `question_versions`: one storage location per fact, and the response
models simply omit it. `explanation` supports post-submission feedback.

### 8.6 Enums replaced by `varchar` + `CHECK`

The diagram drew these as free strings. Validating with `CHECK` makes the database
reject bad values while keeping migrations and type changes simple.

### 8.7 snake_case table names

Diagram names are ALL_CAPS; Postgres folds unquoted identifiers to lowercase
anyway, so the models use lowercase from the start.

### 8.8 Multi-select and answer-option ordering

`UNIQUE (question_version_id, position)` keeps options ordered. Multi-select is
explicit via `allows_multiple_answers` (multiple-choice only). There is no partial
unique index forcing a single correct option, because multi-select legitimately
has several.

---

## 9. Remaining open questions

1. **Flag reason** — `is_flagged` has no companion note; a flagged question gives
   no reason. Out of the current ACs.
2. **Re-categorization** — `category_id` is stored on `questions`, so moving a
   question changes the category for every version. That is the accepted MVP
   behaviour; freezing it per version remains a future option.
3. **Timestamps** — versions track `submitted_at`/`reviewed_at` but not
   `created_at`/`updated_at`. Add them if the UI needs revision history ordering.
