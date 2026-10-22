from typing import Literal

from pydantic import BaseModel, ConfigDict

# Capabilities:

# GET /api/v1/questions

# Returns every practice question currently eligible for exam delivery.

# Eligibility requires all three of:

# review_status = "approved"
# publication_status = "active"
# is_flagged = false

# Response 200
# {
#   "items": [
#     {
#       "id": "v-1004",
#       "question_text": "Which Scrum event is timeboxed to 15 minutes?",
#       "question_type": "multiple_choice",
#       "difficulty": "easy",
#       "options": [
#         { "position": 1, "option_text": "Daily Scrum" },
#         { "position": 2, "option_text": "Sprint Review" }
#       ]
#     }
#   ],
#   "count": 1
# }

# `answer_options.is_correct` and `text_answer_keys.expected_answer` are
# deliberately absent from every model below, so answer keys cannot reach a
# learner before submission.

# Response 401
# {
#   "detail": "Authentication required"
# }

# Responses:
# 200 successful
# 401 Unauthorized (missing, invalid or expired bearer token)
# 422 Validation Error


class QuestionOptionOut(BaseModel):
    """A selectable option. Never exposes which option is correct."""

    model_config = ConfigDict(from_attributes=True)

    position: int
    option_text: str


class QuestionOut(BaseModel):
    """A question as shown to a learner before they answer."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    question_text: str
    question_type: Literal["multiple_choice", "short_answer"]
    difficulty: Literal["easy", "medium", "hard"]
    options: list[QuestionOptionOut]


class QuestionList(BaseModel):
    """The paginated-free envelope returned by the delivery endpoint."""

    items: list[QuestionOut]
    count: int
