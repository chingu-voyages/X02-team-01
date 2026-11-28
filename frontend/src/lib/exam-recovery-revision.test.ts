import { describe, expect, it } from "vitest";
import { createRecoveryRevision, isRecoveryRevisionConflict } from "./exam-recovery-revision";
import { ApiError } from "@/lib/api-client";

describe("JHEP-89 recovery revision", () => {
  it("advances only by one acknowledged mutation", () => {
    const revision = createRecoveryRevision(0);
    revision.confirm(0, 1);
    revision.confirm(1, 2);
    expect(revision.current()).toBe(2);
  });
  it.each([undefined, 0, 2, -1, NaN, Infinity, 1.5])("rejects invalid acknowledgements (%s)", (acknowledged) => {
    const revision = createRecoveryRevision(0);
    expect(() => revision.confirm(0, acknowledged)).toThrow(ApiError);
    expect(revision.current()).toBe(0);
  });
  it("rejects a stale confirmation without advancing the cursor", () => {
    const revision = createRecoveryRevision(5);
    revision.confirm(5, 6);
    expect(() => revision.confirm(5, 6)).toThrow(ApiError);
    expect(revision.current()).toBe(6);
  });
  it.each([-1, 0.5, NaN, Infinity])("rejects an invalid initial revision (%s)", (initial) => {
    expect(() => createRecoveryRevision(initial)).toThrow();
  });
  it("keeps a legacy cursor unversioned", () => {
    const revision = createRecoveryRevision();
    revision.confirm(undefined, undefined);
    expect(revision.current()).toBeUndefined();
  });
  it("distinguishes a stale revision from other 409 errors", () => {
    expect(isRecoveryRevisionConflict(new ApiError(409, "Conflict", { code: "RECOVERY_REVISION_CONFLICT" }))).toBe(true);
    expect(isRecoveryRevisionConflict(new ApiError(409, "Question already submitted"))).toBe(false);
    expect(isRecoveryRevisionConflict(new Error("Offline"))).toBe(false);
  });
});
