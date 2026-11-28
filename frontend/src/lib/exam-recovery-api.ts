import { apiRequest } from "@/lib/api-client";

/** Both fields are required: clearing an answer must be an explicit operation. */
export type ExamDraftAnswer = {
  selected_option_ids: readonly string[] | null;
  text_response: string | null;
};

export type ExamDraftSaved = {
  attempt_id: string;
  question_version_id: string;
  selected_option_ids?: string[] | null;
  text_response?: string | null;
  is_submitted: boolean;
  answered_at: string;
  question_count: number;
  answered_count: number;
  unanswered_count: number;
};

export type ExamPositionSaved = {
  attempt_id: string;
  status: "in_progress" | "submitted";
  current_position: number;
  question_count: number;
  answered_count: number;
  unanswered_count: number;
};

export class ExamSaveConfirmationError extends Error {
  constructor() {
    super("Unable to confirm the save. Please retry before leaving this exam.");
    this.name = "ExamSaveConfirmationError";
  }
}

/** Save a draft without submitting it, grading it, or creating an attempt. */
export async function saveExamDraft(
  attemptId: string,
  questionVersionId: string,
  answer: ExamDraftAnswer,
  token: string,
  signal?: AbortSignal,
): Promise<ExamDraftSaved> {
  // Do not accidentally turn an incomplete object into a destructive clear.
  if (
    !answer ||
    (answer.selected_option_ids !== null && !Array.isArray(answer.selected_option_ids)) ||
    (answer.text_response !== null && typeof answer.text_response !== "string")
  ) {
    throw new TypeError("A draft must explicitly include selections and text.");
  }

  // Snapshot caller-owned arrays before the asynchronous request starts.
  const selections = answer.selected_option_ids === null
    ? null
    : [...answer.selected_option_ids];
  const text = answer.text_response;
  const saved = await apiRequest<ExamDraftSaved>(
    `/exams/${encodeURIComponent(attemptId)}/responses/${encodeURIComponent(questionVersionId)}`,
    token,
    {
      method: "PUT",
      body: JSON.stringify({ selected_option_ids: selections, text_response: text }),
      ...(signal ? { signal } : {}),
    },
  );

  const expectedSelections = selections ?? [];
  const savedSelections = saved?.selected_option_ids ?? [];
  const sortedExpected = [...expectedSelections].sort();
  // The existing backend trims text and omits null fields in this response.
  // Never feed that normalized echo back into the learner's active input.
  if (
    !saved ||
    saved.attempt_id !== attemptId ||
    saved.question_version_id !== questionVersionId ||
    saved.is_submitted !== false ||
    !Array.isArray(savedSelections) ||
    savedSelections.length !== expectedSelections.length ||
    [...savedSelections].sort().some((value, index) => value !== sortedExpected[index]) ||
    (saved.text_response ?? null) !== (text?.trim() || null)
  ) {
    throw new ExamSaveConfirmationError();
  }

  return saved;
}

/** Persist a 1-based position; this is not an answer submission. */
export async function saveExamPosition(
  attemptId: string,
  currentPosition: number,
  token: string,
  signal?: AbortSignal,
): Promise<ExamPositionSaved> {
  if (!Number.isInteger(currentPosition) || currentPosition < 1) {
    throw new RangeError("The saved question position must be a positive integer.");
  }

  const saved = await apiRequest<ExamPositionSaved>(
    `/exams/${encodeURIComponent(attemptId)}/progress`,
    token,
    {
      method: "PATCH",
      body: JSON.stringify({ current_position: currentPosition }),
      ...(signal ? { signal } : {}),
    },
  );

  if (
    !saved ||
    saved.attempt_id !== attemptId ||
    saved.status !== "in_progress" ||
    saved.current_position !== currentPosition
  ) {
    throw new ExamSaveConfirmationError();
  }

  return saved;
}
