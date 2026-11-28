import {
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  RefreshCw,
  Rocket,
  TrendingUp,
  Users,
} from "lucide-react";
import { useId } from "react";
import type { PublishedPracticeExam } from "@/types/practice-exam-api.types";
import {
  getExamAvailabilityIssue,
  isValidExamCount,
  type ExamStartIssue,
} from "./examAvailability";

export type ExamCardVariant = "featured" | "standard" | "alt";

interface BrowseExamCardProps {
  exam: PublishedPracticeExam;
  variant: ExamCardVariant;
  iconIndex?: number;
  isStarting: boolean;
  disabled?: boolean;
  onStartExam: (exam: PublishedPracticeExam) => void;
  onContinueExam?: () => void;
  startIssue?: ExamStartIssue;
  onReload?: () => void;
}

const cardIcons = [Rocket, Users, TrendingUp] as const;

const cardBackgrounds: Record<ExamCardVariant, string> = {
  featured:
    "bg-[radial-gradient(circle_at_88%_12%,rgba(249,139,36,0.34),transparent_46%),radial-gradient(circle_at_82%_95%,rgba(249,139,36,0.22),transparent_42%),linear-gradient(160deg,#23226c_0%,#19184d_55%,#15143f_100%)]",
  standard:
    "bg-[radial-gradient(circle_at_22%_88%,rgba(124,119,232,0.42),transparent_52%),linear-gradient(160deg,#302f8c_0%,#23226d_58%,#1b1a54_100%)]",
  alt: "bg-[radial-gradient(circle_at_86%_90%,rgba(249,139,36,0.2),transparent_44%),radial-gradient(circle_at_20%_15%,rgba(84,81,196,0.35),transparent_50%),linear-gradient(160deg,#23226c_0%,#1c1b57_58%,#171645_100%)]",
};

export default function BrowseExamCard({
  exam,
  variant,
  iconIndex = 0,
  isStarting,
  disabled = false,
  onStartExam,
  onContinueExam,
  startIssue,
  onReload,
}: BrowseExamCardProps) {
  const titleId = useId();
  const countId = `${titleId}-count`;
  const issueId = `${titleId}-issue`;
  const resumeId = `${titleId}-resume`;
  const Icon = cardIcons[iconIndex % cardIcons.length];
  const isFeatured = variant === "featured";
  const canResume = onContinueExam !== undefined;
  const availabilityIssue = canResume ? null : getExamAvailabilityIssue(exam);
  const requiresReload = !canResume && Boolean(availabilityIssue || startIssue?.requiresReload);
  const message = canResume ? null : startIssue?.message ?? availabilityIssue;
  const actionLabel = canResume ? "Continue exam" : "Start exam";
  const statusLabel = canResume ? "In progress" : requiresReload ? "Unavailable" : "Available";
  const validCount = isValidExamCount(exam.question_count);
  const descriptions = [countId, canResume ? resumeId : null, message ? issueId : null]
    .filter(Boolean).join(" ");

  return (
    <article
      aria-labelledby={titleId}
      aria-busy={isStarting}
      className={`flex min-w-0 flex-col gap-3 rounded-2xl p-4 text-white shadow-md sm:min-h-90 sm:gap-4 sm:p-6 ${cardBackgrounds[variant]}`}
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <span
          aria-hidden="true"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-white/22 bg-white/14 text-white sm:size-13"
        >
          <Icon className="size-5 stroke-[1.75] sm:size-6.5" />
        </span>

        {isFeatured && !requiresReload ? (
          <span className="inline-flex items-center rounded-full bg-brand-accent-tint px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-brand-text">
            Recommended
          </span>
        ) : (
          <span
            aria-hidden="true"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-brand-text shadow-2xs sm:size-10"
          >
            <ArrowUpRight className="size-4 stroke-[2.25]" />
          </span>
        )}
      </div>

      <p className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-white/90">
        <span
          aria-hidden="true"
          className={`size-2 shrink-0 rounded-full ${canResume ? "bg-brand-accent" : requiresReload ? "bg-amber-300" : "bg-emerald-400"}`}
        />
        <span>{statusLabel}</span>
      </p>

      <div className="min-w-0 space-y-1.5">
        <h3
          id={titleId}
          className="wrap-anywhere text-lg font-bold leading-snug tracking-tight text-white sm:text-xl"
        >
          {exam.name}
        </h3>
        <p className="wrap-anywhere text-sm leading-5 text-indigo-100/90">
          {exam.certification_name} · {exam.category_name}
        </p>
      </div>

      <div id={countId} className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        {validCount ? (
          <>
            <span className="text-3xl font-bold leading-none tracking-tight text-white tabular-nums">{exam.question_count}</span>
            <span className="text-sm font-medium text-white/90">{exam.question_count === 1 ? "question" : "questions"}</span>
            {canResume && <span className="basis-full text-xs text-indigo-100/90">Current length for new attempts</span>}
          </>
        ) : (
          <span className="text-sm font-semibold text-white">Question count unavailable</span>
        )}
      </div>

      {canResume && (
        <div id={resumeId} role="status" className="min-w-0 space-y-1 rounded-xl border border-white/25 bg-white/10 p-3 text-sm leading-5 text-white">
          <p className="wrap-anywhere font-medium">You have an unfinished attempt for {exam.name}.</p>
          <p className="text-xs text-indigo-100/90">Your existing attempt keeps its original question count and order.</p>
        </div>
      )}

      {message && (
        <div
          id={issueId}
          role={startIssue ? "alert" : undefined}
          className={`flex min-w-0 items-start gap-2 rounded-xl border p-3 text-sm leading-5 ${requiresReload ? "border-amber-200/70 bg-amber-50 text-amber-950" : "border-red-200 bg-red-50 text-red-950"}`}
        >
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p className="min-w-0 wrap-anywhere">{message}</p>
        </div>
      )}

      <div className="mt-auto flex min-w-0 flex-col gap-2 pt-2">
        <span className="text-xs text-white/80">From the approved bank</span>
        <button
          type="button"
          aria-label={`${actionLabel} — ${exam.name}`}
          aria-describedby={descriptions}
          disabled={disabled || isStarting || requiresReload}
          onClick={() => {
            if (disabled || isStarting || requiresReload) return;
            if (onContinueExam) onContinueExam();
            else onStartExam(exam);
          }}
          className={`inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-bold transition-colors focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#19184d] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
            isFeatured
              ? "bg-brand-accent text-brand-text shadow-sm hover:bg-brand-accent/90"
              : "bg-white text-brand-primary shadow-2xs hover:bg-brand-surface"
          }`}
        >
          <span>{isStarting ? "Starting..." : actionLabel}</span>
          <ArrowRight aria-hidden="true" className="size-4 shrink-0 stroke-[2.25]" />
        </button>
        {requiresReload && onReload && (
          <button
            type="button"
            disabled={disabled || isStarting}
            onClick={onReload}
            aria-describedby={issueId}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-white/60 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none disabled:opacity-50"
          >
            <RefreshCw aria-hidden="true" className="size-4 shrink-0" />
            Reload exams
          </button>
        )}
      </div>
    </article>
  );
}
