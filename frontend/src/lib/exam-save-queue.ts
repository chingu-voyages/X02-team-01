import type { ExamDraftAnswer } from "./exam-recovery-api";

export type ExamSaveOperation =
  | { kind: "draft"; questionVersionId: string; answer: ExamDraftAnswer }
  | { kind: "position"; currentPosition: number };

export type ExamSaveState = {
  status: "idle" | "pending" | "saving" | "saved" | "error" | "disposed";
  pendingCount: number;
  error: unknown;
};

export type ExamSaveWriter = (
  operation: ExamSaveOperation,
  signal: AbortSignal,
) => Promise<unknown>;

type QueueOptions = {
  delayMs?: number;
  onStateChange?: (state: ExamSaveState) => void;
};

function copyOperation(operation: ExamSaveOperation): ExamSaveOperation {
  return operation.kind === "position"
    ? { ...operation }
    : {
        ...operation,
        answer: {
          selected_option_ids: operation.answer.selected_option_ids === null
            ? null
            : [...operation.answer.selected_option_ids],
          text_response: operation.answer.text_response,
        },
      };
}

function operationKey(operation: ExamSaveOperation): string {
  return operation.kind === "draft"
    ? `draft:${operation.questionVersionId}`
    : "position";
}

/**
 * One queue per authenticated attempt, never a module-level singleton.
 *
 * Serializes requests within that queue and keeps the newest pending value
 * per question/position. A failed write pauses the queue until explicit retry;
 * the failure and all unsaved work remain observable. It does not persist data
 * across browser closure or provide cross-tab/server concurrency control.
 *
 * The caller must dispose the queue on unmount, account change or attempt
 * change. Aborting a request does NOT prove the server rolled it back: reload
 * authoritative state before reconciling an uncertain save in the next session.
 */
export function createExamSaveQueue(
  write: ExamSaveWriter,
  { delayMs = 400, onStateChange }: QueueOptions = {},
) {
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new RangeError("The save delay must be a finite, non-negative number.");
  }

  let pending = new Map<string, ExamSaveOperation>();
  let active: {
    key: string;
    operation: ExamSaveOperation;
    controller: AbortController;
  } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let disposed = false;
  let failed = false;
  let lastError: unknown = null;
  let currentStatus: ExamSaveState["status"] = "idle";
  const waiters = new Set<(saved: boolean) => void>();

  function getState(): ExamSaveState {
    return {
      status: disposed ? "disposed" : currentStatus,
      pendingCount: pending.size + (active ? 1 : 0),
      error: lastError,
    };
  }

  function notify(status: ExamSaveState["status"]) {
    if (disposed) return;
    currentStatus = status;
    onStateChange?.(getState());
  }

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function settleWaiters(saved: boolean) {
    for (const resolve of waiters) resolve(saved);
    waiters.clear();
  }

  async function drain() {
    try {
      while (!disposed && !failed && pending.size > 0) {
        const next = pending.entries().next().value;
        if (!next) break;
        const [key, operation] = next;
        pending.delete(key);
        const controller = new AbortController();
        active = { key, operation, controller };
        notify("saving");

        try {
          // A writer must not be able to mutate the copy retained for retry.
          await write(copyOperation(operation), controller.signal);
        } catch (error: unknown) {
          if (disposed) return;
          // An edit made during this request is newer than the failed payload.
          if (!pending.has(key)) {
            pending = new Map([[key, operation], ...pending]);
          }
          active = null;
          failed = true;
          lastError = error;
          notify("error");
          settleWaiters(false);
          return;
        }

        if (disposed) return;
        active = null;
      }

      if (!disposed && !failed && pending.size === 0) {
        notify("saved");
        settleWaiters(true);
      }
    } finally {
      running = false;
    }
  }

  function start() {
    clearTimer();
    if (disposed || failed || running || pending.size === 0) return;
    running = true;
    // drain catches writer failures and resolves flush waiters explicitly.
    void drain();
  }

  function enqueue(operation: ExamSaveOperation): boolean {
    if (disposed) return false;
    pending.set(operationKey(operation), copyOperation(operation));
    if (failed) {
      notify("error");
      return true;
    }
    notify(active ? "saving" : "pending");
    if (!running) {
      clearTimer();
      timer = setTimeout(start, delayMs);
    }
    return true;
  }

  /** Resolves only when all queued writes are acknowledged, or saving fails. */
  function flush(): Promise<boolean> {
    clearTimer();
    if (disposed || failed) return Promise.resolve(false);
    if (!active && pending.size === 0) return Promise.resolve(true);
    const result = new Promise<boolean>((resolve) => waiters.add(resolve));
    start();
    return result;
  }

  function retry(): Promise<boolean> {
    if (disposed) return Promise.resolve(false);
    failed = false;
    lastError = null;
    return flush();
  }

  /** An immutable copy for a future account/attempt-scoped recovery journal. */
  function getPendingOperations(): ExamSaveOperation[] {
    const snapshot = new Map<string, ExamSaveOperation>();
    if (active) snapshot.set(active.key, active.operation);
    for (const [key, operation] of pending) snapshot.set(key, operation);
    return [...snapshot.values()].map(copyOperation);
  }

  /** Stops future writes/callbacks; never silently flushes under another user. */
  function dispose() {
    if (disposed) return;
    disposed = true;
    clearTimer();
    active?.controller.abort();
    active = null;
    pending.clear();
    settleWaiters(false);
  }

  return { enqueue, flush, retry, dispose, getState, getPendingOperations };
}
