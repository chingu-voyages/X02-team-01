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
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          aria-pressed={isAllSelected}
          onClick={onSelectAll}
          className={`inline-flex h-10.5 cursor-pointer items-center gap-2 rounded-full border px-4.5 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:outline-none ${
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

        <div className="relative inline-flex items-center">
          <label htmlFor="certification-filter" className="sr-only">
            Certification or topic
          </label>
          <select
            id="certification-filter"
            value={selectedCertificationId}
            onChange={(event) => onSelectCertification(event.target.value)}
            className="h-10.5 max-w-full cursor-pointer appearance-none rounded-full border border-brand-border bg-white pl-4.5 pr-10 text-sm font-semibold text-brand-text transition-colors hover:border-brand-primary focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:outline-none"
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