import type { ExamAttempt, ExamQuestionWithResponse } from "@/types/exam-api.types";
import type { ExamSaveOperation } from "./exam-save-queue";

// Pending content only; never store a bearer token, answer key or full exam.
// This is same-origin device storage, NOT encrypted account storage.
export const recoveryJournalPrefix = "jhep.exam-recovery.v1:";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const retentionMs = 7 * 24 * 60 * 60 * 1000;
const maxOperations = 101;

export type RecoveryCopy = {
  key: string;
  raw: string;
  revision: number;
  updatedAt: number;
  operations: ExamSaveOperation[];
  canRestore: boolean;
};

type JournalStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

/** This is a namespace hint only. Call after an authenticated attempt GET. */
export function recoveryAccount(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const encoded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload: unknown = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")));
    return payload !== null && typeof payload === "object" && "sub" in payload &&
      typeof payload.sub === "string" && uuidPattern.test(payload.sub) ? payload.sub.toLowerCase() : null;
  } catch {
    return null;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function operationKey(operation: ExamSaveOperation): string {
  return operation.kind === "position" ? "position" : `draft:${operation.questionVersionId}`;
}

function parseOperation(value: unknown): ExamSaveOperation | null {
  if (!record(value)) return null;
  if (value.kind === "position" && typeof value.currentPosition === "number" &&
      Number.isInteger(value.currentPosition) && value.currentPosition >= 1 && value.currentPosition <= 100) {
    return { kind: "position", currentPosition: value.currentPosition };
  }
  if (value.kind !== "draft" || typeof value.questionVersionId !== "string" ||
      !value.questionVersionId || !record(value.answer)) return null;
  const selected = value.answer.selected_option_ids;
  const answerText = value.answer.text_response;
  if (selected !== null && (!Array.isArray(selected) || selected.some((id: unknown) => typeof id !== "string" || !id))) return null;
  if (answerText !== null && typeof answerText !== "string") return null;
  if (Array.isArray(selected) && new Set(selected).size !== selected.length) return null;
  return { kind: "draft", questionVersionId: value.questionVersionId,
    answer: { selected_option_ids: selected as string[] | null, text_response: answerText } };
}

function decode(raw: string): Omit<RecoveryCopy, "key" | "raw" | "canRestore"> | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!record(value) || value.version !== 1 || !validRevision(value.revision) ||
        typeof value.updatedAt !== "number" || !Number.isFinite(value.updatedAt) ||
        !Array.isArray(value.operations) || value.operations.length === 0 || value.operations.length > maxOperations) return null;
    const operations: ExamSaveOperation[] = [];
    const seen = new Set<string>();
    for (const candidate of value.operations) {
      const operation = parseOperation(candidate);
      if (!operation || seen.has(operationKey(operation))) return null;
      seen.add(operationKey(operation));
      operations.push(operation);
    }
    return { revision: value.revision, updatedAt: value.updatedAt, operations };
  } catch {
    return null;
  }
}

function pinnedQuestion(attempt: ExamAttempt, operation: Extract<ExamSaveOperation, { kind: "draft" }>) {
  return attempt.questions.find((question) => question.id === operation.questionVersionId);
}

function permittedDraft(question: ExamQuestionWithResponse | undefined, operation: Extract<ExamSaveOperation, { kind: "draft" }>): boolean {
  if (!question || question.response?.is_submitted) return false;
  const choices = operation.answer.selected_option_ids ?? [];
  const answerText = operation.answer.text_response;
  if (question.question_type === "short_answer") return choices.length === 0 && (answerText?.length ?? 0) <= 10000;
  return answerText === null && choices.length <= 10 &&
    (question.allows_multiple_answers || choices.length <= 1) &&
    choices.every((id) => question.options.some((option) => option.id === id));
}

function matchesSaved(attempt: ExamAttempt, operation: ExamSaveOperation): boolean {
  if (operation.kind === "position") return attempt.current_position === operation.currentPosition;
  const question = pinnedQuestion(attempt, operation);
  if (!question) return false;
  const stored = [...(question.response?.selected_option_ids ?? [])].sort();
  const local = [...(operation.answer.selected_option_ids ?? [])].sort();
  return stored.length === local.length && stored.every((id, index) => id === local[index]) &&
    (question.response?.text_response?.trim() || null) === (operation.answer.text_response?.trim() || null);
}

export function canRestoreRecoveryCopy(copy: Pick<RecoveryCopy, "revision" | "operations">, attempt: ExamAttempt): boolean {
  return attempt.status === "in_progress" && validRevision(attempt.recovery_revision) &&
    copy.revision === attempt.recovery_revision && copy.operations.every((operation) =>
      operation.kind === "position" ? operation.currentPosition <= attempt.questions.length : permittedDraft(pinnedQuestion(attempt, operation), operation));
}

/** Each page owns a different key. No tab writes another tab's journal. */
export function createRecoveryJournal(storage: JournalStorage, account: string, attemptId: string, writerId: string, now = Date.now) {
  if (![account, attemptId, writerId].every((id) => uuidPattern.test(id))) throw new Error("Invalid recovery scope");
  const prefix = `${recoveryJournalPrefix}${account.toLowerCase()}:${attemptId.toLowerCase()}:`;
  const writerPrefix = prefix + writerId.toLowerCase() + ":";
  let sequence = 0;
  let lastKey: string | null = null;
  let lastSignature: string | null = null;
  let unreadable = false;

  function removeIfUnchanged(copy: Pick<RecoveryCopy, "key" | "raw">): boolean {
    if (!copy.key.startsWith(prefix) || storage.getItem(copy.key) !== copy.raw) return false;
    storage.removeItem(copy.key);
    return true;
  }

  function list(attempt: ExamAttempt): RecoveryCopy[] {
    unreadable = false;
    if (attempt.attempt_id.toLowerCase() !== attemptId.toLowerCase()) throw new Error("Mismatched recovery attempt");
    // Snapshots are immutable keys. A concurrent tab can create a new key,
    // but removing the snapshot we inspected can never remove that new key.
    const writers = new Map<string, { key: string; sequence: number }[]>();
    for (let index = 0; index < storage.length; index++) {
      const candidate = storage.key(index);
      if (!candidate?.startsWith(prefix) || candidate.startsWith(writerPrefix)) continue;
      const [writer, number, extra] = candidate.slice(prefix.length).split(":");
      const snapshot = Number(number);
      if (extra !== undefined || !uuidPattern.test(writer) || !Number.isSafeInteger(snapshot) || snapshot < 1) continue;
      const existing = writers.get(writer) ?? [];
      existing.push({ key: candidate, sequence: snapshot });
      writers.set(writer, existing);
    }
    const copies: RecoveryCopy[] = [];
    for (const snapshots of writers.values()) {
      snapshots.sort((left, right) => right.sequence - left.sequence);
      const candidate = snapshots[0].key;
      const raw = storage.getItem(candidate);
      if (raw === null) continue;
      const decoded = decode(raw);
      // Corrupt/unrecognized records are not replayed or exposed as answers.
      // Leave them untouched rather than silently deleting unknown data.
      if (!decoded) { unreadable = true; continue; }
      // A crash between writing a replacement and deleting the old copy
      // can leave two snapshots. Only the latest is eligible for recovery.
      for (const older of snapshots.slice(1)) storage.removeItem(older.key);
      if (now() - decoded.updatedAt > retentionMs) {
        removeIfUnchanged({ key: candidate, raw });
        continue;
      }
      // A lost acknowledgement may still have committed. Do not resend it.
      if (decoded.operations.every((operation) => matchesSaved(attempt, operation))) {
        removeIfUnchanged({ key: candidate, raw });
        continue;
      }
      copies.push({ ...decoded, key: candidate, raw, canRestore: canRestoreRecoveryCopy(decoded, attempt) });
    }
    return copies.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  function save(revision: number, operations: readonly ExamSaveOperation[]): boolean {
    if (!validRevision(revision)) return false;
    try {
      if (!operations.length) {
        if (lastKey !== null) storage.removeItem(lastKey);
        lastKey = null;
        lastSignature = null;
        return true;
      }
      const signature = JSON.stringify({ revision, operations });
      if (signature === lastSignature && lastKey && storage.getItem(lastKey) !== null) return true;
      const raw = JSON.stringify({ version: 1, revision, updatedAt: now(), operations });
      // Write the replacement first. A quota failure keeps the old copy.
      if (!decode(raw)) return false;
      const nextKey = writerPrefix + String(++sequence);
      storage.setItem(nextKey, raw);
      const previous = lastKey;
      lastKey = nextKey;
      lastSignature = signature;
      if (previous !== null) storage.removeItem(previous);
      return true;
    } catch {
      return false;
    }
  }

  return { list, save, removeIfUnchanged, hasUnreadableCopies: () => unreadable, isUnchanged: (copy: RecoveryCopy) =>
    copy.key.startsWith(prefix) && storage.getItem(copy.key) === copy.raw };
}
