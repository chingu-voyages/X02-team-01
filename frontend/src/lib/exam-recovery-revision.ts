import { ApiError } from "@/lib/api-client";

export const recoveryConflictMessage =
  "Progress changed in another tab or could not be confirmed. Your latest input is still on this page. Copy any unsaved answers before reloading the latest saved progress.";

export function isRecoveryRevisionConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 &&
    error.detail !== null && typeof error.detail === "object" &&
    "code" in error.detail && error.detail.code === "RECOVERY_REVISION_CONFLICT";
}

function conflict(): ApiError {
  return new ApiError(409, recoveryConflictMessage, { code: "RECOVERY_REVISION_CONFLICT" });
}

/** One cursor per authenticated attempt load. Never silently adopt a newer revision. */
export function createRecoveryRevision(initial?: number) {
  if (initial !== undefined && (!Number.isSafeInteger(initial) || initial < 0)) {
    throw new Error("Unable to verify the saved exam revision. Please try again.");
  }
  let value = initial;
  return {
    current: () => value,
    confirm(expected: number | undefined, acknowledged: number | undefined) {
      // Backwards compatibility for existing unversioned deployments/fixtures.
      if (value === undefined && expected === undefined) return;
      if (expected === undefined || expected !== value ||
          !Number.isSafeInteger(acknowledged) || acknowledged !== expected + 1) {
        throw conflict();
      }
      value = acknowledged;
    },
  };
}
