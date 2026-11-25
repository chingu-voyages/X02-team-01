interface ExamSelectionStatusProps {
  loadStatus: "loading" | "ready" | "error";
  loadError: string;
  totalExamCount: number;
  visibleExamCount: number;
  startError: string;
  onRetryLoad: () => void;
}

export default function ExamSelectionStatus({
  loadStatus,
  loadError,
  totalExamCount,
  visibleExamCount,
  startError,
  onRetryLoad,
}: ExamSelectionStatusProps) {
  return (
    <>
      {startError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-red-200 bg-red-50/80 p-5 text-brand-text"
        >
          <p className="text-sm font-semibold text-red-800">{startError}</p>
          <button
            type="button"
            onClick={onRetryLoad}
            className="min-h-10 cursor-pointer rounded-full border border-brand-border bg-white px-4 text-xs font-semibold text-brand-text transition-colors hover:bg-brand-surface"
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
          className="rounded-2xl border border-brand-border bg-white p-6 shadow-xs"
        >
          <p className="mb-4 text-sm text-red-700">{loadError}</p>
          <button
            type="button"
            onClick={onRetryLoad}
            className="cursor-pointer rounded-full bg-brand-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-primary-dark"
          >
            Retry loading practice exams
          </button>
        </div>
      )}

      {loadStatus === "ready" && totalExamCount === 0 && (
        <p
          role="status"
          className="rounded-2xl border border-brand-border bg-white p-6 text-sm text-brand-text/70 shadow-xs"
        >
          No published practice exams are currently available.
        </p>
      )}

      {loadStatus === "ready" &&
        totalExamCount > 0 &&
        visibleExamCount === 0 && (
          <p
            role="status"
            className="rounded-2xl border border-brand-border bg-white p-6 text-sm text-brand-text/70 shadow-xs"
          >
            No published exams match this certification.
          </p>
        )}
    </>
  );
}
