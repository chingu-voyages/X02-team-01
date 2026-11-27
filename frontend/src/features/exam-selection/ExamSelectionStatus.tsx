interface ExamSelectionStatusProps {
  loadStatus: "loading" | "ready" | "error";
  loadError: string;
  totalExamCount: number;
  visibleExamCount: number;
  startError?: string;
  onRetryLoad: () => void;
}

export default function ExamSelectionStatus({
  loadStatus,
  loadError,
  totalExamCount,
  visibleExamCount,
  startError = "",
  onRetryLoad,
}: ExamSelectionStatusProps) {
  return (
    <>
      {startError && (
        <div
          role="alert"
          className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50/80 p-4 text-brand-text sm:p-5"
        >
          <p className="min-w-0 wrap-anywhere text-sm font-semibold text-red-800">{startError}</p>
          <button
            type="button"
            onClick={onRetryLoad}
            className="min-h-11 w-full cursor-pointer rounded-full border border-brand-border bg-white px-4 text-sm font-semibold text-brand-text transition-colors hover:bg-brand-surface sm:w-auto"
          >
            Reload exams
          </button>
        </div>
      )}

      {loadStatus === "loading" && (
        <p role="status" className="py-10 text-sm text-brand-text/70">
          Loading practice exams...
        </p>
      )}

      {loadStatus === "error" && (
        <div
          role="alert"
          className="rounded-2xl border border-red-200 bg-white p-4 shadow-xs sm:p-6"
        >
          <p className="mb-4 wrap-anywhere text-sm text-red-700">{loadError}</p>
          <button
            type="button"
            onClick={onRetryLoad}
            className="min-h-11 w-full cursor-pointer rounded-full bg-brand-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-primary-dark sm:w-auto"
          >
            Retry loading practice exams
          </button>
        </div>
      )}

      {loadStatus === "ready" && totalExamCount === 0 && (
        <div className="rounded-2xl border border-brand-border bg-white p-4 shadow-xs sm:p-6">
          <p role="status" className="text-sm text-brand-text/70">
            No published practice exams are currently available.
          </p>
          <button
            type="button"
            onClick={onRetryLoad}
            className="mt-4 min-h-11 w-full cursor-pointer rounded-full border border-brand-border px-5 py-2.5 text-sm font-semibold text-brand-text hover:bg-brand-surface sm:w-auto"
          >
            Reload exams
          </button>
        </div>
      )}

      {loadStatus === "ready" &&
        totalExamCount > 0 &&
        visibleExamCount === 0 && (
          <p
            role="status"
            className="rounded-2xl border border-brand-border bg-white p-4 text-sm text-brand-text/70 shadow-xs sm:p-6"
          >
            No published exams match this certification.
          </p>
        )}
    </>
  );
}
