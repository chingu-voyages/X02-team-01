import { ChevronDown } from "lucide-react";

export interface CertificationOption {
  id: string;
  name: string;
}

interface ExamFilterBarProps {
  certifications: readonly CertificationOption[];
  selectedCertificationId: string;
  totalExamCount: number;
  visibleExamCount: number;
  onSelectAll: () => void;
  onSelectCertification: (certificationId: string) => void;
}

export default function ExamFilterBar({
  certifications,
  selectedCertificationId,
  totalExamCount,
  visibleExamCount,
  onSelectAll,
  onSelectCertification,
}: ExamFilterBarProps) {
  const isAllSelected = selectedCertificationId === "all";

  return (
    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
        <button
          type="button"
          aria-pressed={isAllSelected}
          onClick={onSelectAll}
          className={`inline-flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-full border px-4 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto ${
            isAllSelected
              ? "border-[#18183e] bg-[#18183e] text-white"
              : "border-brand-border bg-white text-brand-text hover:border-brand-primary"
          }`}
        >
          <span>All categories</span>
          <span
            className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-bold leading-none ${
              isAllSelected
                ? "bg-brand-primary text-white"
                : "bg-brand-surface text-brand-primary"
            }`}
          >
            {totalExamCount}
          </span>
        </button>

        <div className="relative inline-flex w-full min-w-0 items-center sm:w-auto sm:max-w-xs">
          <label htmlFor="certification-filter" className="sr-only">
            Certification or topic
          </label>
          <select
            id="certification-filter"
            value={selectedCertificationId}
            onChange={(event) => onSelectCertification(event.target.value)}
            className="min-h-11 w-full min-w-0 max-w-full cursor-pointer appearance-none truncate rounded-full border border-brand-border bg-white pl-4 pr-10 text-sm font-semibold text-brand-text transition-colors hover:border-brand-primary focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="all">Certification / topic</option>
            {certifications.map((certification) => (
              <option key={certification.id} value={certification.id}>
                {certification.name}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute right-3.5 size-4 text-brand-text"
          />
        </div>
      </div>

      <p
        aria-live="polite"
        className="text-xs font-semibold text-brand-text/75 sm:text-sm"
      >
        {visibleExamCount} {visibleExamCount === 1 ? "exam" : "exams"} available
      </p>
    </div>
  );
}
