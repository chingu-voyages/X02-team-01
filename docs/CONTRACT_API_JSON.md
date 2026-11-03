# JHEP — Screens 03–10: API Routes and Mock JSON Responses

**Team review draft · Updated for PR #18**

**Status:** `PR18` = implemented at the reviewed PR #18 commit; available on `dev` after merge and the required migrations. `EXTENSION` = proposed additional fields, not returned by PR #18. `PROPOSED` = route not implemented by PR #18. All IDs, content, dates, and percentages are mock values.

**Contract baseline:** [PR #18](https://github.com/chingu-voyages/X02-team-01/pull/18), commit `385f8d5` — [response schemas](https://github.com/chingu-voyages/X02-team-01/blob/385f8d59aa7f9264704f8a9b057b688b739b96ac/backend/app/schemas/exam.py), [routes](https://github.com/chingu-voyages/X02-team-01/blob/385f8d59aa7f9264704f8a9b057b688b739b96ac/backend/app/api/v1/endpoints/exams.py), and [response/submission behavior](https://github.com/chingu-voyages/X02-team-01/blob/385f8d59aa7f9264704f8a9b057b688b739b96ac/backend/app/services/exam_attempt_service.py). This document does not assert that the PR has already been merged or deployed.

`category` remains the **screen display label** (example: `Agile Fundamentals`), while `category_id` and `category_name` identify the underlying question-bank topic (example: `Agile Principles`). Categories are still required for the screens, but PR #18 does not add category fields or category-based generation. Their proposed JSON fragments are kept separate from actual PR18 responses.

All PR18 exam routes require `Authorization: Bearer <token>`.

## 1. Wireframe-to-API mapping

| Screen | API route | Contract |
|---|---|---|
| 03 — Exam selection | `GET /api/v1/exam-catalog` | PROPOSED |
| 03 — Categories | `GET /api/v1/certifications/{certification_id}/categories` | PROPOSED |
| 04 — Instructions | `GET /api/v1/exam-catalog/{catalog_id}` | PROPOSED |
| 05 — Start exam | `POST /api/v1/exams` | PR18 + category EXTENSION |
| 06 — Resume exam | `GET /api/v1/exams/{attempt_id}` | PR18 + display EXTENSION |
| 06 — Save answer | `PUT /api/v1/exams/{attempt_id}/responses/{question_version_id}` | PR18 |
| 06 — Save position | `PATCH /api/v1/exams/{attempt_id}/progress` | PR18 |
| 07 — Submit answer / feedback | `POST /api/v1/exams/{attempt_id}/responses/{question_version_id}/submit` | PR18 |
| 07 — Complete exam | `POST /api/v1/exams/{attempt_id}/submit` | PR18 |
| 08 — View results | `GET /api/v1/exams/{attempt_id}/results` | PR18 + display EXTENSION |
| 08 — Set passing threshold (admin) | `PATCH /api/v1/admin/exam-catalog/{catalog_id}/settings` | PROPOSED; PR18 uses certification-level DB configuration |
| 08 — Try again | `POST /api/v1/exams` | PR18 + category EXTENSION |
| 09 — Review questions | `GET /api/v1/exams/{attempt_id}/review` | PROPOSED |
| 10 — Attempt history | `GET /api/v1/me/exam-attempts` | PROPOSED |

## 2. Mock JSON by screen

## Screen 03 — Exam selection

**GET** `/api/v1/exam-catalog` — **PROPOSED**

**200 response**
```json
{
  "items": [
    {
      "category": "Agile Fundamentals",
      "catalog_id": "agile-principles-practice",
      "description": "Core iterative-delivery and feedback concepts",
      "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d",
      "certification_name": "Agile Fundamentals",
      "category_id": "42e9c25f-4ada-5147-a894-d7fbcb0df5b7",
      "category_name": "Agile Principles",
      "available_question_count": 36,
      "default_question_count": 2,
      "max_question_count": 36,
      "available": true,
      "practice_set_name": "Agile Principles Practice"
    },
    {
      "category": "Agile Fundamentals",
      "catalog_id": "scrum-events-practice",
      "description": "Practice the purpose and structure of Scrum events",
      "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d",
      "certification_name": "Agile Fundamentals",
      "category_id": "df69c511-6384-59d7-a591-f5633d3b5642",
      "category_name": "Scrum Events",
      "available_question_count": 22,
      "default_question_count": 10,
      "max_question_count": 22,
      "available": true,
      "practice_set_name": "Scrum Events Practice"
    },
    {
      "category": "Agile Fundamentals",
      "catalog_id": "agile-fundamentals-all",
      "description": "Questions spanning the full certification",
      "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d",
      "certification_name": "Agile Fundamentals",
      "category_id": null,
      "category_name": "All Categories",
      "available_question_count": 82,
      "default_question_count": 10,
      "max_question_count": 82,
      "available": true,
      "practice_set_name": "Agile Fundamentals — All Categories"
    }
  ],
  "count": 3
}
```

**GET** `/api/v1/certifications/{certification_id}/categories` — **PROPOSED**

**200 response**
```json
{
  "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d",
  "items": [
    {
      "id": "42e9c25f-4ada-5147-a894-d7fbcb0df5b7",
      "name": "Agile Principles",
      "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d"
    },
    {
      "id": "df69c511-6384-59d7-a591-f5633d3b5642",
      "name": "Scrum Events",
      "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d"
    },
    {
      "id": "f3c0ba2c-c33c-5f06-821d-6a566a7ef5ad",
      "name": "Team Collaboration",
      "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d"
    }
  ],
  "count": 3
}
```

## Screen 04 — Exam instructions

**GET** `/api/v1/exam-catalog/{catalog_id}` — **PROPOSED**

**200 response**
```json
{
  "category": "Agile Fundamentals",
  "catalog_id": "agile-principles-practice",
  "description": "Core iterative-delivery and feedback concepts",
  "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d",
  "certification_name": "Agile Fundamentals",
  "category_id": "42e9c25f-4ada-5147-a894-d7fbcb0df5b7",
  "category_name": "Agile Principles",
  "available_question_count": 36,
  "default_question_count": 2,
  "min_question_count": 1,
  "max_question_count": 36,
  "time_limit_seconds": null,
  "passing_score_percent": 80,
  "instructions": [
    "Questions are selected randomly from approved and active content.",
    "Your answers are saved as you progress.",
    "You can review completed attempts after submission."
  ],
  "practice_set_name": "Agile Principles Practice"
}
```

## Screen 05 — Start exam

**POST** `/api/v1/exams` — **PR18; category EXTENSION remains proposed**

**Request — PR18**
```json
{
  "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d",
  "question_count": 2
}
```

**201 response — PR18**
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
        },
        {
          "id": "e3f63715-00c4-5c77-b91d-c340ef95edc1",
          "position": 3,
          "option_text": "Minimize stakeholder participation"
        }
      ],
      "images": []
    },
    {
      "id": "b5e4352f-f616-5b2e-9313-978405aed09d",
      "position": 2,
      "question_text": "Which practices help agile teams inspect and adapt? Select all that apply.",
      "question_type": "multiple_choice",
      "allows_multiple_answers": true,
      "difficulty": "medium",
      "options": [
        {
          "id": "d1d2d37e-565f-51f7-a6ee-1b1fb5c7e528",
          "position": 1,
          "option_text": "Hold regular retrospectives"
        },
        {
          "id": "060a3d97-7aca-5ccd-b407-e9470cbc982b",
          "position": 2,
          "option_text": "Invite feedback from stakeholders"
        },
        {
          "id": "6d2edf8a-b836-5d59-bb93-bb9cc9539868",
          "position": 3,
          "option_text": "Avoid changing the plan until release"
        }
      ],
      "images": []
    }
  ]
}
```

**Category-aware request — EXTENSION only; not accepted by PR18**
```json
{
  "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d",
  "category_id": "42e9c25f-4ada-5147-a894-d7fbcb0df5b7",
  "question_count": 2
}
```

**Additional display fields — EXTENSION only; not part of the 201 response above**
```json
{
  "category": "Agile Fundamentals",
  "catalog_id": "agile-principles-practice",
  "certification_name": "Agile Fundamentals",
  "category_id": "42e9c25f-4ada-5147-a894-d7fbcb0df5b7",
  "category_name": "Agile Principles",
  "current_position": 1,
  "passing_score_percent": 80,
  "time_limit_seconds": null
}
```

Question-level `category_id` and `category_name` also remain proposed additions. PR18 accepts only `certification_id` and `question_count`; sending `category_id` produces `422`.

**409 response — certification has no configured passing threshold**
```json
{
  "detail": "Certification has no passing threshold configured"
}
```

## Screen 06 — Exam interface, saving answers and navigation

**GET** `/api/v1/exams/{attempt_id}` — **PR18; display EXTENSION remains proposed**

**200 response — PR18**
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
        },
        {
          "id": "e3f63715-00c4-5c77-b91d-c340ef95edc1",
          "position": 3,
          "option_text": "Minimize stakeholder participation"
        }
      ],
      "images": [],
      "response": {
        "question_version_id": "b7656038-9d60-5c70-aecb-d8fc62af2dd5",
        "selected_option_ids": [
          "66b3d8f0-2e47-53bd-bfb6-b54aaf5d0ed4"
        ],
        "is_submitted": false,
        "answered_at": "2026-10-29T14:01:00Z"
      }
    },
    {
      "id": "b5e4352f-f616-5b2e-9313-978405aed09d",
      "position": 2,
      "question_text": "Which practices help agile teams inspect and adapt? Select all that apply.",
      "question_type": "multiple_choice",
      "allows_multiple_answers": true,
      "difficulty": "medium",
      "options": [
        {
          "id": "d1d2d37e-565f-51f7-a6ee-1b1fb5c7e528",
          "position": 1,
          "option_text": "Hold regular retrospectives"
        },
        {
          "id": "060a3d97-7aca-5ccd-b407-e9470cbc982b",
          "position": 2,
          "option_text": "Invite feedback from stakeholders"
        },
        {
          "id": "6d2edf8a-b836-5d59-bb93-bb9cc9539868",
          "position": 3,
          "option_text": "Avoid changing the plan until release"
        }
      ],
      "images": []
    }
  ]
}
```

`attempt_id` identifies the exam attempt. Each question's `id` is its **question-version ID**; use that value as `{question_version_id}` in save/submit routes. PR18 does not return `attempt_question_id` or a separate question-level `question_version_id` alias. The saved `response` block does include `question_version_id`.

A question with no saved answer has no `response` field. Null-valued fields are omitted from this route, including `text_response` for multiple-choice answers and an image's `url` when unavailable. While the attempt is in progress, this resume route omits `is_correct` in both feedback modes—even after an immediate-feedback question was submitted.

**Additional display fields — EXTENSION only; not part of the GET response above**
```json
{
  "category": "Agile Fundamentals",
  "catalog_id": "agile-principles-practice",
  "certification_name": "Agile Fundamentals",
  "category_id": "42e9c25f-4ada-5147-a894-d7fbcb0df5b7",
  "category_name": "Agile Principles",
  "answered_count": 1,
  "unanswered_count": 1
}
```

Question-level `category_id` and `category_name` also remain proposed. The GET response does not include answered/unanswered totals; the save and progress responses below do.

**PUT** `/api/v1/exams/{attempt_id}/responses/{question_version_id}` — **PR18**

**Request**
```json
{
  "selected_option_ids": [
    "66b3d8f0-2e47-53bd-bfb6-b54aaf5d0ed4"
  ],
  "text_response": null
}
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
  "answered_at": "2026-10-29T14:01:00Z",
  "question_count": 2,
  "answered_count": 1,
  "unanswered_count": 1
}
```

`answered_at` replaces the earlier proposed `saved_at` field. `is_submitted` is `false` for a draft; `is_correct` is omitted. For a short-answer question, send `text_response` instead of option selections. An empty object `{}` clears an unlocked draft; a locked question or completed attempt returns `409`.

**PATCH** `/api/v1/exams/{attempt_id}/progress` — **PR18**

**Request**
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

Category fields in save/progress confirmations remain an **EXTENSION**, using `category`, `category_id`, and `category_name` from the display proposal above.

## Screen 07 — Submit answer and complete exam

**POST** `/api/v1/exams/{attempt_id}/responses/{question_version_id}/submit` — **PR18**

**Request — send the answer being submitted, even if already saved as a draft**
```json
{
  "selected_option_ids": [
    "66b3d8f0-2e47-53bd-bfb6-b54aaf5d0ed4"
  ],
  "text_response": null
}
```

**200 response — immediate feedback mode**
```json
{
  "attempt_id": "f45ab512-829f-55e7-bc44-e710396aa939",
  "question_version_id": "b7656038-9d60-5c70-aecb-d8fc62af2dd5",
  "is_submitted": true,
  "question_submitted_at": "2026-10-29T14:01:05Z",
  "feedback_released": true,
  "is_correct": false,
  "correct_option_ids": [
    "0777bf91-1d23-5059-93d4-dfa99abd914c"
  ],
  "explanation": "Iterative delivery encourages frequent feedback and adaptation."
}
```

**200 response — deferred feedback mode**
```json
{
  "attempt_id": "f45ab512-829f-55e7-bc44-e710396aa939",
  "question_version_id": "b7656038-9d60-5c70-aecb-d8fc62af2dd5",
  "is_submitted": true,
  "question_submitted_at": "2026-10-29T14:01:05Z",
  "feedback_released": false
}
```

These are alternative responses for different configured modes, not two submissions of the same question. `feedback_released: false` means correctness, correct-option IDs, and explanation are omitted, not returned as `null`. Submitting locks the question; resubmission or editing it returns `409`. Submitting an empty answer returns `422`.

**POST** `/api/v1/exams/{attempt_id}/submit` — **PR18**

**Request:** No body.

**200 response — answered/unanswered counts**
```json
{
  "attempt_id": "f45ab512-829f-55e7-bc44-e710396aa939",
  "status": "submitted",
  "question_count": 2,
  "answered_count": 2,
  "unanswered_count": 0,
  "submitted_at": "2026-10-29T14:05:01Z",
  "results_url": "/api/v1/exams/f45ab512-829f-55e7-bc44-e710396aa939/results"
}
```

This example assumes both answers were individually submitted. **In PR18, saving a draft is not the same as submitting it:** final submission grades only individually submitted answers and does not automatically submit saved drafts. A saved multiple-choice draft can count as answered while being scored as unanswered. A repeated final submission returns `409`.

**Category display fields — EXTENSION only; not returned by either route above**
```json
{
  "category": "Agile Fundamentals",
  "category_id": "42e9c25f-4ada-5147-a894-d7fbcb0df5b7",
  "category_name": "Agile Principles"
}
```

## Screen 08 — Results, passing threshold and Try Again

**GET** `/api/v1/exams/{attempt_id}/results` — **PR18**

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
  "passing_score_percent": 80,
  "passed": false,
  "grading_complete": true,
  "submitted_at": "2026-10-29T14:05:01Z",
  "graded_at": "2026-10-29T14:05:02Z"
}
```

`incorrect_count` excludes `unanswered_graded_count`; the latter counts gradable multiple-choice questions with no submitted answer. Short answers (`ungraded_count`) and invalid-key questions (`ungradable_count`) are excluded from the score denominator. `grading_complete` means automatic grading is complete, not that short answers were graded. With zero gradable questions, `score_percent` and `passed` are explicitly `null`. Use the server's `passed` value rather than recomputing from the rounded percentage.

**Additional display fields — EXTENSION only; not part of the results response above**
```json
{
  "category": "Agile Fundamentals",
  "catalog_id": "agile-principles-practice",
  "certification_name": "Agile Fundamentals",
  "category_id": "42e9c25f-4ada-5147-a894-d7fbcb0df5b7",
  "category_name": "Agile Principles",
  "started_at": "2026-10-29T14:00:00Z",
  "review_url": "/api/v1/exams/f45ab512-829f-55e7-bc44-e710396aa939/review"
}
```

PR18 does not return `review_url`, category/catalog labels, or `started_at` here. The proposed `review_url` points to the backend JSON contract under **Screen 09**, not a frontend page. That review endpoint remains unimplemented by PR18. Final submission returns the implemented `results_url` shown under Screen 07.

**PATCH** `/api/v1/admin/exam-catalog/{catalog_id}/settings` — **PROPOSED — admin only**

This route is retained as a proposal, not added by PR18. The PR currently stores `passing_threshold_pct` as an integer from 0–100 on the **certification**, configured through the database. Any future catalog settings route must respect that shared certification scope unless the backend model changes. Each new attempt snapshots its threshold; later changes do not change existing attempts.

**Request — proposed configurable passing percentage**
```json
{
  "passing_score_percent": 80
}
```

**200 response — PROPOSED**
```json
{
  "category": "Agile Fundamentals",
  "catalog_id": "agile-principles-practice",
  "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d",
  "certification_name": "Agile Fundamentals",
  "category_id": "42e9c25f-4ada-5147-a894-d7fbcb0df5b7",
  "category_name": "Agile Principles",
  "passing_score_percent": 80,
  "updated_at": "2026-10-29T13:45:00Z"
}
```

**POST** `/api/v1/exams` — **PR18; category EXTENSION remains proposed — Try Again**

**Request — create a new attempt, not resubmit the completed one**
```json
{
  "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d",
  "question_count": 2
}
```

**201 response — PR18; new `attempt_id`**
```json
{
  "attempt_id": "4591e862-881a-58bc-bb51-38f5b6615a3a",
  "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d",
  "status": "in_progress",
  "question_count": 2,
  "questions": [
    {
      "id": "b5e4352f-f616-5b2e-9313-978405aed09d",
      "position": 1,
      "question_text": "Which practices help agile teams inspect and adapt? Select all that apply.",
      "question_type": "multiple_choice",
      "allows_multiple_answers": true,
      "difficulty": "medium",
      "options": [
        {
          "id": "d1d2d37e-565f-51f7-a6ee-1b1fb5c7e528",
          "position": 1,
          "option_text": "Hold regular retrospectives"
        },
        {
          "id": "060a3d97-7aca-5ccd-b407-e9470cbc982b",
          "position": 2,
          "option_text": "Invite feedback from stakeholders"
        },
        {
          "id": "6d2edf8a-b836-5d59-bb93-bb9cc9539868",
          "position": 3,
          "option_text": "Avoid changing the plan until release"
        }
      ],
      "images": []
    },
    {
      "id": "b7656038-9d60-5c70-aecb-d8fc62af2dd5",
      "position": 2,
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
        },
        {
          "id": "e3f63715-00c4-5c77-b91d-c340ef95edc1",
          "position": 3,
          "option_text": "Minimize stakeholder participation"
        }
      ],
      "images": []
    }
  ]
}
```

Try Again creates a separate attempt and leaves the previous one intact. Question-version IDs may repeat across attempts; a fresh attempt does not guarantee different questions. Category-aware retry uses the proposed request under Screen 05 only after that extension is implemented. The category display fields above remain required proposals for this screen. All passing percentages shown are examples, not defaults.

## Screen 09 — Question review

**GET** `/api/v1/exams/{attempt_id}/review` — **PROPOSED; not added by PR18**

**200 response — submitted answers, correct answers, category and explanation**
```json
{
  "category": "Agile Fundamentals",
  "attempt_id": "f45ab512-829f-55e7-bc44-e710396aa939",
  "catalog_id": "agile-principles-practice",
  "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d",
  "certification_name": "Agile Fundamentals",
  "category_id": "42e9c25f-4ada-5147-a894-d7fbcb0df5b7",
  "category_name": "Agile Principles",
  "status": "submitted",
  "submitted_at": "2026-10-29T14:05:01Z",
  "questions": [
    {
      "id": "b7656038-9d60-5c70-aecb-d8fc62af2dd5",
      "question_version_id": "b7656038-9d60-5c70-aecb-d8fc62af2dd5",
      "position": 1,
      "question_text": "What is the primary goal of iterative delivery?",
      "question_type": "multiple_choice",
      "allows_multiple_answers": false,
      "difficulty": "easy",
      "category_id": "42e9c25f-4ada-5147-a894-d7fbcb0df5b7",
      "category_name": "Agile Principles",
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
        },
        {
          "id": "e3f63715-00c4-5c77-b91d-c340ef95edc1",
          "position": 3,
          "option_text": "Minimize stakeholder participation"
        }
      ],
      "images": [],
      "selected_option_ids": [
        "66b3d8f0-2e47-53bd-bfb6-b54aaf5d0ed4"
      ],
      "correct_option_ids": [
        "0777bf91-1d23-5059-93d4-dfa99abd914c"
      ],
      "is_correct": false,
      "explanation": "Iterative delivery encourages frequent feedback and adaptation.",
      "submitted_at": "2026-10-29T14:01:05Z"
    },
    {
      "id": "b5e4352f-f616-5b2e-9313-978405aed09d",
      "question_version_id": "b5e4352f-f616-5b2e-9313-978405aed09d",
      "position": 2,
      "question_text": "Which practices help agile teams inspect and adapt? Select all that apply.",
      "question_type": "multiple_choice",
      "allows_multiple_answers": true,
      "difficulty": "medium",
      "category_id": "42e9c25f-4ada-5147-a894-d7fbcb0df5b7",
      "category_name": "Agile Principles",
      "options": [
        {
          "id": "d1d2d37e-565f-51f7-a6ee-1b1fb5c7e528",
          "position": 1,
          "option_text": "Hold regular retrospectives"
        },
        {
          "id": "060a3d97-7aca-5ccd-b407-e9470cbc982b",
          "position": 2,
          "option_text": "Invite feedback from stakeholders"
        },
        {
          "id": "6d2edf8a-b836-5d59-bb93-bb9cc9539868",
          "position": 3,
          "option_text": "Avoid changing the plan until release"
        }
      ],
      "images": [],
      "selected_option_ids": [
        "d1d2d37e-565f-51f7-a6ee-1b1fb5c7e528",
        "060a3d97-7aca-5ccd-b407-e9470cbc982b"
      ],
      "correct_option_ids": [
        "d1d2d37e-565f-51f7-a6ee-1b1fb5c7e528",
        "060a3d97-7aca-5ccd-b407-e9470cbc982b"
      ],
      "is_correct": true,
      "explanation": "Retrospectives and stakeholder feedback help teams inspect and adapt.",
      "submitted_at": "2026-10-29T14:04:10Z"
    }
  ],
  "count": 2
}
```

## Screen 10 — Attempt history

**GET** `/api/v1/me/exam-attempts` — **PROPOSED; not added by PR18**

**200 response — previous attempts, scores and review URLs**
```json
{
  "items": [
    {
      "category": "Agile Fundamentals",
      "attempt_id": "f45ab512-829f-55e7-bc44-e710396aa939",
      "catalog_id": "agile-principles-practice",
      "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d",
      "certification_name": "Agile Fundamentals",
      "category_id": "42e9c25f-4ada-5147-a894-d7fbcb0df5b7",
      "category_name": "Agile Principles",
      "status": "submitted",
      "submitted_at": "2026-10-29T14:05:01Z",
      "question_count": 2,
      "score_percent": 50.0,
      "passing_score_percent": 80,
      "passed": false,
      "review_url": "/api/v1/exams/f45ab512-829f-55e7-bc44-e710396aa939/review"
    },
    {
      "category": "Agile Fundamentals",
      "attempt_id": "3861dbff-f0c5-5a09-bec2-4ebf60a6daef",
      "catalog_id": "agile-principles-practice",
      "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d",
      "certification_name": "Agile Fundamentals",
      "category_id": "42e9c25f-4ada-5147-a894-d7fbcb0df5b7",
      "category_name": "Agile Principles",
      "status": "submitted",
      "submitted_at": "2026-10-14T10:20:00Z",
      "question_count": 10,
      "score_percent": 90.0,
      "passing_score_percent": 80,
      "passed": true,
      "review_url": "/api/v1/exams/3861dbff-f0c5-5a09-bec2-4ebf60a6daef/review"
    },
    {
      "category": "Agile Fundamentals",
      "attempt_id": "e72e80df-b56d-56bb-950d-ca58a6ca4632",
      "catalog_id": "scrum-events-practice",
      "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d",
      "certification_name": "Agile Fundamentals",
      "category_id": "df69c511-6384-59d7-a591-f5633d3b5642",
      "category_name": "Scrum Events",
      "status": "submitted",
      "submitted_at": "2026-10-09T10:19:00Z",
      "question_count": 10,
      "score_percent": 70.0,
      "passing_score_percent": 80,
      "passed": false,
      "review_url": "/api/v1/exams/e72e80df-b56d-56bb-950d-ca58a6ca4632/review"
    }
  ],
  "page": 1,
  "page_size": 20,
  "total": 3
}
```

