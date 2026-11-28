import { Button } from "@/components/ui/button";
import type { ExamSaveState } from "@/lib/exam-save-queue";

interface ExamSaveStatusProps {
  state: ExamSaveState;
  errorMessage: string;
  canRetry: boolean;
  disabled: boolean;
  onRetry: () => void;
  onLeave?: () => void;
  canLeave?: boolean;
  isLeaving?: boolean;
  leaveError?: string;
}

/** Saving a draft is distinct from submitting an answer or finishing an exam. */
export default function ExamSaveStatus({ state, errorMessage, canRetry, disabled, onRetry, onLeave, canLeave = false, isLeaving = false, leaveError = "" }: ExamSaveStatusProps) {
  const failed = state.status === "error";
  const pending = state.status === "pending" || state.status === "saving";
  const message = pending ? "Saving progress…" : state.status === "saved"
    ? "Progress saved" : "Your drafts and question position save automatically.";

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-brand-border bg-white px-4 py-3 text-sm text-brand-text sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1 wrap-anywhere">
        {/* Keep one live region for routine progress; errors are urgent. */}
        <p role="status" aria-live="polite" aria-atomic="true" className={failed ? "sr-only" : "font-medium"}>
          {failed ? "" : message}
        </p>
        {failed && (
          <div role="alert" className="space-y-1 text-red-700">
            <p className="font-semibold">Changes not saved</p>
            <p>{errorMessage}</p>
          </div>
        )}
        {state.status === "saved" && <p className="mt-1 text-xs text-brand-text/75">Drafts and question position are saved separately from answer submission.</p>}
        {onLeave && <p className="mt-1 text-xs text-brand-text/75">Take a break and continue later without submitting your exam.</p>}
        {leaveError && <p role="alert" className="mt-1 text-red-700">{leaveError}</p>}
      </div>
      {((failed && canRetry) || onLeave) && (
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {failed && canRetry && (
            <Button type="button" variant="outline" onClick={onRetry} disabled={disabled}
              className="min-h-11 w-full border-brand-border text-brand-text hover:bg-brand-surface sm:w-auto">
              Retry saving
            </Button>
          )}
          {onLeave && (
            <Button type="button" variant="outline" disabled={disabled || !canLeave} onClick={onLeave}
              className="min-h-11 w-full border-brand-primary/45 text-brand-primary hover:bg-brand-surface sm:w-auto">
              {isLeaving ? "Saving and leaving…" : "Save and leave"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
