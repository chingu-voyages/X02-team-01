import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createExamSaveQueue,
  type ExamSaveOperation,
  type ExamSaveState,
  type ExamSaveWriter,
} from "./exam-save-queue";

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function draft(questionVersionId: string, text: string): ExamSaveOperation {
  return { kind: "draft", questionVersionId, answer: { selected_option_ids: null, text_response: text } };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("JHEP-89 ordered exam save queue", () => {
  it("does not save or clear anything merely by being created", async () => {
    const write = vi.fn<ExamSaveWriter>().mockResolvedValue(undefined);
    const queue = createExamSaveQueue(write);
    expect(queue.getState()).toEqual({ status: "idle", pendingCount: 0, error: null });
    await expect(queue.flush()).resolves.toBe(true);
    expect(write).not.toHaveBeenCalled();
    queue.dispose();
  });

  it("debounces rapid typing and writes the latest pending draft", async () => {
    const write = vi.fn<ExamSaveWriter>().mockResolvedValue(undefined);
    const queue = createExamSaveQueue(write);
    queue.enqueue(draft("q1", "f"));
    await vi.advanceTimersByTimeAsync(200);
    queue.enqueue(draft("q1", "final"));
    await vi.advanceTimersByTimeAsync(399);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toEqual(draft("q1", "final"));
    expect(queue.getState().status).toBe("saved");
    queue.dispose();
  });

  it("flush bypasses the debounce", async () => {
    const write = vi.fn<ExamSaveWriter>().mockResolvedValue(undefined);
    const queue = createExamSaveQueue(write);
    queue.enqueue(draft("q1", "now"));
    await expect(queue.flush()).resolves.toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    queue.dispose();
  });

  it("coalesces position updates without deleting another question's draft", async () => {
    const write = vi.fn<ExamSaveWriter>().mockResolvedValue(undefined);
    const queue = createExamSaveQueue(write);
    queue.enqueue(draft("q1", "one"));
    queue.enqueue({ kind: "position", currentPosition: 2 });
    queue.enqueue(draft("q2", "two"));
    queue.enqueue({ kind: "position", currentPosition: 4 });
    await queue.flush();
    expect(write.mock.calls.map(([operation]) => operation)).toEqual([
      draft("q1", "one"), { kind: "position", currentPosition: 4 }, draft("q2", "two"),
    ]);
    queue.dispose();
  });

  it("allows only one request at a time", async () => {
    const first = deferred();
    const write = vi.fn<ExamSaveWriter>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined);
    const queue = createExamSaveQueue(write);
    queue.enqueue(draft("q1", "one"));
    queue.enqueue(draft("q2", "two"));
    const done = queue.flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(queue.getState()).toMatchObject({ status: "saving", pendingCount: 2 });
    first.resolve();
    await expect(done).resolves.toBe(true);
    expect(write).toHaveBeenCalledTimes(2);
    queue.dispose();
  });

  it("does not mark newer input saved when an older request finishes", async () => {
    const first = deferred();
    const second = deferred();
    const write = vi.fn<ExamSaveWriter>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const states: ExamSaveState[] = [];
    const queue = createExamSaveQueue(write, { onStateChange: (state) => states.push(state) });
    queue.enqueue(draft("q1", "old"));
    const done = queue.flush();
    queue.enqueue(draft("q1", "latest"));
    first.resolve();
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(2);
    expect(queue.getState().status).toBe("saving");
    expect(states.some((state) => state.status === "saved")).toBe(false);
    second.resolve();
    await expect(done).resolves.toBe(true);
    expect(queue.getState().status).toBe("saved");
    queue.dispose();
  });

  it("coalesces multiple edits made while an older save is in flight", async () => {
    const first = deferred();
    const write = vi.fn<ExamSaveWriter>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined);
    const queue = createExamSaveQueue(write);
    queue.enqueue(draft("q1", "old"));
    const done = queue.flush();
    queue.enqueue(draft("q1", "middle"));
    queue.enqueue(draft("q1", "latest"));
    first.resolve();
    await done;
    expect(write.mock.calls.map(([operation]) => operation)).toEqual([draft("q1", "old"), draft("q1", "latest")]);
    queue.dispose();
  });

  it("retains failed work and pauses automatic retries", async () => {
    const failure = new Error("offline");
    const write = vi.fn<ExamSaveWriter>().mockRejectedValue(failure);
    const queue = createExamSaveQueue(write);
    queue.enqueue(draft("q1", "keep me"));
    await expect(queue.flush()).resolves.toBe(false);
    expect(queue.getState()).toEqual({ status: "error", pendingCount: 1, error: failure });
    expect(queue.getPendingOperations()).toEqual([draft("q1", "keep me")]);
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(queue.flush()).resolves.toBe(false);
    expect(write).toHaveBeenCalledTimes(1);
    queue.dispose();
  });

  it("retries the latest edit rather than restoring the obsolete failed payload", async () => {
    const first = deferred();
    const write = vi.fn<ExamSaveWriter>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined);
    const queue = createExamSaveQueue(write);
    queue.enqueue(draft("q1", "old"));
    const done = queue.flush();
    queue.enqueue(draft("q1", "latest"));
    first.reject(new Error("offline"));
    await expect(done).resolves.toBe(false);
    expect(queue.getPendingOperations()).toEqual([draft("q1", "latest")]);
    await expect(queue.retry()).resolves.toBe(true);
    expect(write.mock.calls[1][0]).toEqual(draft("q1", "latest"));
    expect(queue.getState()).toEqual({ status: "saved", pendingCount: 0, error: null });
    queue.dispose();
  });

  it("retains additional questions while blocked and saves them after retry", async () => {
    const write = vi.fn<ExamSaveWriter>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const queue = createExamSaveQueue(write);
    queue.enqueue(draft("q1", "one"));
    queue.enqueue(draft("q2", "two"));
    await queue.flush();
    queue.enqueue(draft("q1", "edited while offline"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(write).toHaveBeenCalledTimes(1);
    await expect(queue.retry()).resolves.toBe(true);
    expect(write.mock.calls.slice(1).map(([operation]) => operation)).toEqual([
      draft("q1", "edited while offline"), draft("q2", "two"),
    ]);
    queue.dispose();
  });

  it("takes a copy of selections instead of retaining a mutable caller array", async () => {
    const write = vi.fn<ExamSaveWriter>().mockResolvedValue(undefined);
    const queue = createExamSaveQueue(write);
    const selections = ["option-a"];
    queue.enqueue({ kind: "draft", questionVersionId: "q1", answer: { selected_option_ids: selections, text_response: null } });
    selections.push("option-b");
    await queue.flush();
    expect(write.mock.calls[0][0]).toMatchObject({ answer: { selected_option_ids: ["option-a"] } });
    queue.dispose();
  });

  it("preserves explicit empty drafts, which mean the user cleared an answer", async () => {
    const write = vi.fn<ExamSaveWriter>().mockResolvedValue(undefined);
    const queue = createExamSaveQueue(write);
    queue.enqueue(draft("q1", ""));
    await queue.flush();
    expect(write.mock.calls[0][0]).toEqual(draft("q1", ""));
    queue.dispose();
  });

  it("does not normalize or trim the draft in the queue", async () => {
    const write = vi.fn<ExamSaveWriter>().mockResolvedValue(undefined);
    const queue = createExamSaveQueue(write);
    queue.enqueue(draft("q1", "  unfinished\ntext  "));
    await queue.flush();
    expect(write.mock.calls[0][0]).toEqual(draft("q1", "  unfinished\ntext  "));
    queue.dispose();
  });

  it("returns a detached snapshot with only the latest value for each key", async () => {
    const first = deferred();
    const queue = createExamSaveQueue(() => first.promise);
    queue.enqueue(draft("q1", "old"));
    const done = queue.flush();
    queue.enqueue(draft("q1", "latest"));
    const snapshot = queue.getPendingOperations();
    expect(snapshot).toEqual([draft("q1", "latest")]);
    const item = snapshot[0];
    if (item.kind === "draft") item.answer.text_response = "external mutation";
    expect(queue.getPendingOperations()).toEqual([draft("q1", "latest")]);
    queue.dispose();
    await expect(done).resolves.toBe(false);
    first.resolve();
  });

  it("settles every concurrent flush caller only after acknowledgement", async () => {
    const first = deferred();
    const queue = createExamSaveQueue(() => first.promise);
    queue.enqueue(draft("q1", "one"));
    const a = queue.flush();
    const b = queue.flush();
    first.resolve();
    await expect(Promise.all([a, b])).resolves.toEqual([true, true]);
    queue.dispose();
  });

  it("cancels an unstarted save when the queue is disposed", async () => {
    const write = vi.fn<ExamSaveWriter>().mockResolvedValue(undefined);
    const queue = createExamSaveQueue(write);
    queue.enqueue(draft("q1", "one"));
    queue.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).not.toHaveBeenCalled();
    expect(queue.enqueue(draft("q2", "two"))).toBe(false);
    await expect(queue.flush()).resolves.toBe(false);
    await expect(queue.retry()).resolves.toBe(false);
  });

  it("aborts an active save and immediately settles waiters on disposal", async () => {
    const first = deferred();
    const write = vi.fn<ExamSaveWriter>().mockImplementation(() => first.promise);
    const queue = createExamSaveQueue(write);
    queue.enqueue(draft("q1", "one"));
    const done = queue.flush();
    const signal = write.mock.calls[0][1];
    expect(signal.aborted).toBe(false);
    queue.dispose();
    expect(signal.aborted).toBe(true);
    await expect(done).resolves.toBe(false);
    expect(queue.getState().status).toBe("disposed");
    first.resolve();
  });

  it("ignores late completion after an account or attempt queue is disposed", async () => {
    const first = deferred();
    const onStateChange = vi.fn();
    const write = vi.fn<ExamSaveWriter>().mockImplementation(() => first.promise);
    const queue = createExamSaveQueue(write, { onStateChange });
    queue.enqueue(draft("q1", "one"));
    const done = queue.flush();
    queue.enqueue(draft("q2", "two"));
    queue.dispose();
    const count = onStateChange.mock.calls.length;
    first.resolve();
    await done;
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);
    expect(onStateChange).toHaveBeenCalledTimes(count);
  });

  it("keeps independent attempts isolated", async () => {
    const writeA = vi.fn<ExamSaveWriter>().mockRejectedValue(new Error("A offline"));
    const writeB = vi.fn<ExamSaveWriter>().mockResolvedValue(undefined);
    const a = createExamSaveQueue(writeA);
    const b = createExamSaveQueue(writeB);
    a.enqueue(draft("shared-question", "A"));
    b.enqueue(draft("shared-question", "B"));
    await expect(a.flush()).resolves.toBe(false);
    await expect(b.flush()).resolves.toBe(true);
    expect(writeB.mock.calls[0][0]).toEqual(draft("shared-question", "B"));
    a.dispose();
    b.dispose();
  });

  it("also retains work when a writer throws before returning a promise", async () => {
    const failure = new Error("synchronous failure");
    const queue = createExamSaveQueue(() => { throw failure; });
    queue.enqueue(draft("q1", "one"));
    await expect(queue.flush()).resolves.toBe(false);
    expect(queue.getState().error).toBe(failure);
    queue.dispose();
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid debounce delay %s", (delayMs) => {
    expect(() => createExamSaveQueue(async () => undefined, { delayMs })).toThrow(RangeError);
  });
});
