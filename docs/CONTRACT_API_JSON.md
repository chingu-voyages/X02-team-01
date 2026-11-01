# JHEP — Screens 03–10: API Routes and Mock JSON Responses

**Team review draft · October 29, 2026**

**Status:** `CURRENT` = implemented on backend `dev`; `EXTENSION` = existing route with proposed additional fields; `PROPOSED` = new route. All IDs, content, and percentages are mock values.

`category` is the **screen display label** (example: `Agile Fundamentals`), while `category_id` and `category_name` identify the underlying question-bank topic (example: `Agile Principles`). Proposed category-aware generation is not yet available on `dev`.

## 1. Wireframe-to-API mapping

| Screen | API route | Contract |
|---|---|---|
| 03 — Exam selection | `GET /api/v1/exam-catalog` | PROPOSED |
| 03 — Categories | `GET /api/v1/certifications/{certification_id}/categories` | PROPOSED |
| 04 — Instructions | `GET /api/v1/exam-catalog/{catalog_id}` | PROPOSED |
| 05 — Start exam | `POST /api/v1/exams` | CURRENT + EXTENSION |
| 06 — Resume exam | `GET /api/v1/exams/{attempt_id}` | CURRENT + EXTENSION |
| 06 — Save answer | `PUT /api/v1/exams/{attempt_id}/responses/{attempt_question_id}` | PROPOSED |
| 06 — Save position | `PATCH /api/v1/exams/{attempt_id}/progress` | PROPOSED |
| 07 — Submit answer / feedback | `POST /api/v1/exams/{attempt_id}/responses/{attempt_question_id}/submit` | PROPOSED |
| 07 — Complete exam | `POST /api/v1/exams/{attempt_id}/submit` | PROPOSED |
| 08 — View results | `GET /api/v1/exams/{attempt_id}/results` | PROPOSED |
| 08 — Set passing threshold (admin) | `PATCH /api/v1/admin/exam-catalog/{catalog_id}/settings` | PROPOSED |
| 08 — Try again | `POST /api/v1/exams` | CURRENT + EXTENSION |
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
  "passing_score_percent": 80.0,
  "instructions": [
    "Questions are selected randomly from approved and active content.",
    "Your answers are saved as you progress.",
    "You can review completed attempts after submission."
  ],
  "practice_set_name": "Agile Principles Practice"
}
```

## Screen 05 — Start exam

**POST** `/api/v1/exams` — **CURRENT endpoint; category EXTENSION proposed**

**Request — proposed with category**
```json
{
  "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d",
  "category_id": "42e9c25f-4ada-5147-a894-d7fbcb0df5b7",
  "question_count": 2
}
```

**201 response — proposed extended fields**
```json
{
  "category": "Agile Fundamentals",
  "attempt_id": "f45ab512-829f-55e7-bc44-e710396aa939",
  "catalog_id": "agile-principles-practice",
  "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d",
  "certification_name": "Agile Fundamentals",
  "category_id": "42e9c25f-4ada-5147-a894-d7fbcb0df5b7",
  "category_name": "Agile Principles",
  "status": "in_progress",
  "question_count": 2,
  "current_position": 1,
  "passing_score_percent": 80.0,
  "time_limit_seconds": null,
  "questions": [
    {
      "id": "b7656038-9d60-5c70-aecb-d8fc62af2dd5",
      "question_version_id": "b7656038-9d60-5c70-aecb-d8fc62af2dd5",
      "attempt_question_id": "e14d4579-8bd2-58a6-8aa4-c34b0cf6a00c",
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
      "images": []
    },
    {
      "id": "b5e4352f-f616-5b2e-9313-978405aed09d",
      "question_version_id": "b5e4352f-f616-5b2e-9313-978405aed09d",
      "attempt_question_id": "77cda7ec-7cb8-5a01-8160-a8b52b9d9f38",
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
      "images": []
    }
  ]
}
```

## Screen 06 — Exam interface, saving answers and navigation

**GET** `/api/v1/exams/{attempt_id}` — **CURRENT endpoint; EXTENSION proposed**

**200 response — proposed extended fields**
```json
{
  "category": "Agile Fundamentals",
  "attempt_id": "f45ab512-829f-55e7-bc44-e710396aa939",
  "catalog_id": "agile-principles-practice",
  "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d",
  "certification_name": "Agile Fundamentals",
  "category_id": "42e9c25f-4ada-5147-a894-d7fbcb0df5b7",
  "category_name": "Agile Principles",
  "status": "in_progress",
  "question_count": 2,
  "current_position": 2,
  "answered_count": 1,
  "unanswered_count": 1,
  "questions": [
    {
      "id": "b7656038-9d60-5c70-aecb-d8fc62af2dd5",
      "question_version_id": "b7656038-9d60-5c70-aecb-d8fc62af2dd5",
      "attempt_question_id": "e14d4579-8bd2-58a6-8aa4-c34b0cf6a00c",
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
      "response": {
        "selected_option_ids": [
          "66b3d8f0-2e47-53bd-bfb6-b54aaf5d0ed4"
        ],
        "text_response": null,
        "saved_at": "2026-10-29T14:01:00Z",
        "submitted_at": null,
        "is_correct": null
      }
    },
    {
      "id": "b5e4352f-f616-5b2e-9313-978405aed09d",
      "question_version_id": "b5e4352f-f616-5b2e-9313-978405aed09d",
      "attempt_question_id": "77cda7ec-7cb8-5a01-8160-a8b52b9d9f38",
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
      "response": null
    }
  ]
}
```

**PUT** `/api/v1/exams/{attempt_id}/responses/{attempt_question_id}` — **PROPOSED**

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
  "attempt_question_id": "e14d4579-8bd2-58a6-8aa4-c34b0cf6a00c",
  "question_version_id": "b7656038-9d60-5c70-aecb-d8fc62af2dd5",
  "category_id": "42e9c25f-4ada-5147-a894-d7fbcb0df5b7",
  "category_name": "Agile Principles",
  "selected_option_ids": [
    "66b3d8f0-2e47-53bd-bfb6-b54aaf5d0ed4"
  ],
  "text_response": null,
  "saved_at": "2026-10-29T14:01:00Z",
  "answered_count": 1,
  "unanswered_count": 1,
  "is_correct": null
}
```

**PATCH** `/api/v1/exams/{attempt_id}/progress` — **PROPOSED**

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
  "category_id": "42e9c25f-4ada-5147-a894-d7fbcb0df5b7",
  "category_name": "Agile Principles",
  "status": "in_progress",
  "current_position": 2,
  "question_count": 2,
  "answered_count": 1,
  "unanswered_count": 1
}
```

## Screen 07 — Submit answer and complete exam

**POST** `/api/v1/exams/{attempt_id}/responses/{attempt_question_id}/submit` — **PROPOSED**

**Request**
```json
{
  "selected_option_ids": [
    "66b3d8f0-2e47-53bd-bfb6-b54aaf5d0ed4"
  ],
  "text_response": null
}
```

**200 response — feedback after question submission**
```json
{
  "attempt_id": "f45ab512-829f-55e7-bc44-e710396aa939",
  "attempt_question_id": "e14d4579-8bd2-58a6-8aa4-c34b0cf6a00c",
  "question_version_id": "b7656038-9d60-5c70-aecb-d8fc62af2dd5",
  "category_id": "42e9c25f-4ada-5147-a894-d7fbcb0df5b7",
  "category_name": "Agile Principles",
  "submitted_at": "2026-10-29T14:01:05Z",
  "is_correct": false,
  "graded_at": "2026-10-29T14:01:05Z",
  "feedback_released": true,
  "correct_option_ids": [
    "0777bf91-1d23-5059-93d4-dfa99abd914c"
  ],
  "explanation": "Iterative delivery encourages frequent feedback and adaptation."
}
```

**POST** `/api/v1/exams/{attempt_id}/submit` — **PROPOSED**

**200 response — answered/unanswered counts**
```json
{
  "attempt_id": "f45ab512-829f-55e7-bc44-e710396aa939",
  "category_id": "42e9c25f-4ada-5147-a894-d7fbcb0df5b7",
  "category_name": "Agile Principles",
  "status": "submitted",
  "question_count": 2,
  "answered_count": 2,
  "unanswered_count": 0,
  "submitted_at": "2026-10-29T14:05:01Z",
  "results_url": "/api/v1/exams/f45ab512-829f-55e7-bc44-e710396aa939/results"
}
```

## Screen 08 — Results, passing threshold and Try Again

**GET** `/api/v1/exams/{attempt_id}/results` — **PROPOSED**

**200 response**
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
  "started_at": "2026-10-29T14:00:00Z",
  "submitted_at": "2026-10-29T14:05:01Z",
  "question_count": 2,
  "answered_count": 2,
  "unanswered_count": 0,
  "correct_count": 1,
  "incorrect_count": 1,
  "graded_count": 2,
  "ungraded_count": 0,
  "score_percent": 50.0,
  "score_basis": "graded_questions_only",
  "grading_complete": true,
  "passing_score_percent": 80.0,
  "passed": false,
  "review_url": "/api/v1/exams/f45ab512-829f-55e7-bc44-e710396aa939/review"
}
```

**PATCH** `/api/v1/admin/exam-catalog/{catalog_id}/settings` — **PROPOSED — admin only**

**Request — configurable passing percentage**
```json
{
  "passing_score_percent": 80.0
}
```

**200 response**
```json
{
  "category": "Agile Fundamentals",
  "catalog_id": "agile-principles-practice",
  "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d",
  "certification_name": "Agile Fundamentals",
  "category_id": "42e9c25f-4ada-5147-a894-d7fbcb0df5b7",
  "category_name": "Agile Principles",
  "passing_score_percent": 80.0,
  "updated_at": "2026-10-29T13:45:00Z"
}
```

**POST** `/api/v1/exams` — **CURRENT endpoint; category EXTENSION proposed — Try Again**

**Request — same exam selection, but create a new attempt**
```json
{
  "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d",
  "category_id": "42e9c25f-4ada-5147-a894-d7fbcb0df5b7",
  "question_count": 2
}
```

**201 response — new `attempt_id`, new assignments**
```json
{
  "category": "Agile Fundamentals",
  "attempt_id": "4591e862-881a-58bc-bb51-38f5b6615a3a",
  "catalog_id": "agile-principles-practice",
  "certification_id": "3c27471b-ed05-5433-b8c5-bf611b1dc12d",
  "certification_name": "Agile Fundamentals",
  "category_id": "42e9c25f-4ada-5147-a894-d7fbcb0df5b7",
  "category_name": "Agile Principles",
  "status": "in_progress",
  "question_count": 2,
  "current_position": 1,
  "passing_score_percent": 80.0,
  "time_limit_seconds": null,
  "questions": [
    {
      "id": "b5e4352f-f616-5b2e-9313-978405aed09d",
      "question_version_id": "b5e4352f-f616-5b2e-9313-978405aed09d",
      "attempt_question_id": "d56846fc-8f42-59c5-948a-9aa8a4f31905",
      "position": 1,
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
      "images": []
    },
    {
      "id": "b7656038-9d60-5c70-aecb-d8fc62af2dd5",
      "question_version_id": "b7656038-9d60-5c70-aecb-d8fc62af2dd5",
      "attempt_question_id": "d7bc9019-9e42-5caf-9e0a-6528e2e1c6f2",
      "position": 2,
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
      "images": []
    }
  ]
}
```

`review_url` is an **authenticated backend JSON endpoint**, not a Next.js page URL. The frontend opens its own review screen and calls that URL. Passing percentages shown are examples, not agreed defaults.

## Screen 09 — Question review

**GET** `/api/v1/exams/{attempt_id}/review` — **PROPOSED**

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
      "attempt_question_id": "e14d4579-8bd2-58a6-8aa4-c34b0cf6a00c",
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
      "attempt_question_id": "77cda7ec-7cb8-5a01-8160-a8b52b9d9f38",
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

**GET** `/api/v1/me/exam-attempts` — **PROPOSED**

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
      "passing_score_percent": 80.0,
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
      "passing_score_percent": 80.0,
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
      "passing_score_percent": 80.0,
      "passed": false,
      "review_url": "/api/v1/exams/e72e80df-b56d-56bb-950d-ca58a6ca4632/review"
    }
  ],
  "page": 1,
  "page_size": 20,
  "total": 3
}
```

