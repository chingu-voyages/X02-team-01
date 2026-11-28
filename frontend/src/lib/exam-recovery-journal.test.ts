import { describe, expect, it } from "vitest";
import type { ExamAttempt } from "@/types/exam-api.types";
import type { ExamSaveOperation } from "./exam-save-queue";
import { createRecoveryJournal, recoveryAccount, recoveryJournalPrefix } from "./exam-recovery-journal";

const account = "11111111-1111-4111-8111-111111111111";
const otherAccount = "22222222-2222-4222-8222-222222222222";
const attemptId = "33333333-3333-4333-8333-333333333333";
const otherAttemptId = "44444444-4444-4444-8444-444444444444";
const writer = "55555555-5555-4555-8555-555555555555";
const otherWriter = "66666666-6666-4666-8666-666666666666";
const thirdWriter = "77777777-7777-4777-8777-777777777777";
const at = 1795800000000;
const text: ExamSaveOperation = { kind: "draft", questionVersionId: "q2", answer: { selected_option_ids: null, text_response: "My draft" } };
const choice: ExamSaveOperation = { kind: "draft", questionVersionId: "q1", answer: { selected_option_ids: ["a"], text_response: null } };
const position: ExamSaveOperation = { kind: "position", currentPosition: 2 };

function storage() {
  const values = new Map<string, string>();
  let blocked = false;
  return {
    values,
    get length() { return values.size; },
    key(index: number) { return [...values.keys()][index] ?? null; },
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { if (blocked) throw new Error("Quota"); values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
    blockWrites() { blocked = true; },
  };
}
function fixture(): ExamAttempt {
  return { attempt_id: attemptId, certification_id: "cert", status: "in_progress", recovery_revision: 4,
    current_position: 1, question_count: 2, questions: [
      { id: "q1", position: 1, question_text: "Choose", question_type: "multiple_choice", allows_multiple_answers: false, difficulty: "easy", images: [], options: [{ id: "a", position: 1, option_text: "A" }, { id: "b", position: 2, option_text: "B" }] },
      { id: "q2", position: 2, question_text: "Explain", question_type: "short_answer", allows_multiple_answers: false, difficulty: "easy", images: [], options: [] },
    ] };
}
function pair() {
  const device = storage();
  const original = createRecoveryJournal(device, account, attemptId, writer, () => at);
  const returned = createRecoveryJournal(device, account, attemptId, otherWriter, () => at + 1);
  return { device, original, returned };
}
function token(subject: string) { return `header.${btoa(JSON.stringify({ sub: subject })).replace(/=+$/, "")}.signature`; }

describe("JHEP-89 durable recovery journal", () => {
  it("uses only the stable UUID subject, never the bearer token", () => {
    expect(recoveryAccount(token(account))).toBe(account);
    expect(recoveryAccount(token(account.toUpperCase()))).toBe(account);
    expect(recoveryAccount(token("invalid"))).toBeNull();
    expect(recoveryAccount("bad-token")).toBeNull();
  });
  it("stores pending selections, text and position synchronously and restores the exact matching revision", () => {
    const { original, returned, device } = pair();
    expect(original.save(4, [choice, text, position])).toBe(true);
    const [copy] = returned.list(fixture());
    expect(copy).toMatchObject({ revision: 4, operations: [choice, text, position], canRestore: true });
    expect([...device.values.values()].join(" ")).not.toContain(token(account));
    expect([...device.values.keys()][0]).toContain(`${recoveryJournalPrefix}${account}:${attemptId}:`);
  });
  it("isolates accounts and attempts even on a shared device", () => {
    const { original, device } = pair();
    original.save(4, [text]);
    expect(createRecoveryJournal(device, otherAccount, attemptId, otherWriter).list(fixture())).toEqual([]);
    expect(createRecoveryJournal(device, account, otherAttemptId, otherWriter).list({ ...fixture(), attempt_id: otherAttemptId })).toEqual([]);
  });
  it("keeps another tab's snapshot independent and never removes its newer snapshot", () => {
    const { original, returned, device } = pair();
    original.save(4, [choice]);
    const old = returned.list(fixture())[0];
    original.save(4, [text]);
    expect(returned.removeIfUnchanged(old)).toBe(false);
    returned.save(4, [position]);
    const copies = createRecoveryJournal(device, account, attemptId, thirdWriter, () => at + 2).list(fixture());
    expect(copies).toHaveLength(2);
    expect(copies.map((copy) => copy.operations)).toContainEqual([text]);
    expect(copies.map((copy) => copy.operations)).toContainEqual([position]);
    returned.save(5, []);
    expect(device.values.size).toBe(1);
  });
  it("preserves the latest unacknowledged operations and updates the base revision after confirmation", () => {
    const { original, returned, device } = pair();
    original.save(4, [choice, text, position]);
    original.save(5, [text, position]);
    expect(device.values.size).toBe(1);
    expect(returned.list({ ...fixture(), recovery_revision: 5 })[0]).toMatchObject({ revision: 5, operations: [text, position], canRestore: true });
    original.save(7, []);
    expect(device.values.size).toBe(0);
  });
  it("keeps a conflicting device copy visible but never replayable", () => {
    const { original, returned } = pair();
    original.save(4, [choice]);
    const server = fixture();
    server.recovery_revision = 5;
    server.questions[0].response = { question_version_id: "q1", selected_option_ids: ["b"], text_response: null, is_submitted: false, answered_at: "2026-11-28T00:00:00Z" };
    expect(returned.list(server)[0]).toMatchObject({ operations: [choice], canRestore: false });
  });
  it("does not replay even at the same revision if a question or attempt is locked", () => {
    const { original, returned } = pair();
    original.save(4, [choice]);
    const server = fixture();
    server.questions[0].response = { question_version_id: "q1", selected_option_ids: ["b"], text_response: null, is_submitted: true, answered_at: "2026-11-28T00:00:00Z" };
    expect(returned.list(server)[0].canRestore).toBe(false);
    expect(returned.list({ ...fixture(), status: "submitted" })[0].canRestore).toBe(false);
  });
  it("recognizes a committed write whose acknowledgement was lost and never sends it again", () => {
    const { original, returned, device } = pair();
    original.save(4, [text, position]);
    const server = { ...fixture(), current_position: 2, recovery_revision: 6 };
    server.questions[1].response = { question_version_id: "q2", selected_option_ids: null, text_response: "My draft", is_submitted: false, answered_at: "2026-11-28T00:00:00Z" };
    expect(returned.list(server)).toEqual([]);
    expect(device.values.size).toBe(0);
  });
  it("refuses unknown questions, invalid choices and out-of-bounds positions", () => {
    const { original, returned } = pair();
    original.save(4, [{ ...choice, questionVersionId: "unknown" }]);
    expect(returned.list(fixture())[0].canRestore).toBe(false);
    original.save(4, [{ ...choice, answer: { selected_option_ids: ["unknown"], text_response: null } }]);
    expect(returned.list(fixture())[0].canRestore).toBe(false);
    original.save(4, [{ kind: "position", currentPosition: 100 }]);
    expect(returned.list(fixture())[0].canRestore).toBe(false);
  });
  it("preserves the last device copy when storage quota is exceeded", () => {
    const { original, returned, device } = pair();
    original.save(4, [choice]);
    device.blockWrites();
    expect(original.save(4, [text])).toBe(false);
    expect(returned.list(fixture())[0].operations).toEqual([choice]);
  });
  it("ignores corrupt data and surfaces an unreadable-copy condition", () => {
    const { returned, device } = pair();
    device.setItem(`${recoveryJournalPrefix}${account}:${attemptId}:${writer}:1`, "{bad JSON");
    expect(returned.list(fixture())).toEqual([]);
    expect(returned.hasUnreadableCopies()).toBe(true);
    expect(device.values.size).toBe(1);
  });
  it("expires old copies without touching another account's data", () => {
    const { original, device } = pair();
    original.save(4, [choice]);
    createRecoveryJournal(device, otherAccount, attemptId, thirdWriter, () => at).save(4, [text]);
    const later = createRecoveryJournal(device, account, attemptId, otherWriter, () => at + 8 * 86400000);
    expect(later.list(fixture())).toEqual([]);
    expect(device.values.size).toBe(1);
  });
});
