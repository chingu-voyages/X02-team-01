import {
  ArrowRight,
  ArrowUpRight,
  Rocket,
  TrendingUp,
  Users,
} from "lucide-react";
import { useId } from "react";
import type { PublishedPracticeExam } from "@/types/practice-exam-api.types";

export type ExamCardVariant = "featured" | "standard" | "alt";

interface BrowseExamCardProps {
  exam: PublishedPracticeExam;
  variant: ExamCardVariant;
  iconIndex?: number;
  isStarting: boolean;
  onStartExam: (exam: PublishedPracticeExam) => void;
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
  onStartExam,
}: BrowseExamCardProps) {
  const titleId = useId();
  const Icon = cardIcons[iconIndex % cardIcons.length];
  const isFeatured = variant === "featured";

  return (
    <article
      aria-labelledby={titleId}
      className={`flex min-h-105 flex-col gap-4 rounded-2xl p-7 text-white shadow-md transition-transform duration-200 hover:-translate-y-0.5 ${cardBackgrounds[variant]}`}
    >
      {/* Top icon and badge row */}
      <div className="flex items-center justify-between gap-3">
        <span
          aria-hidden="true"
          className="inline-flex size-13 shrink-0 items-center justify-center rounded-full border border-white/22 bg-white/14 text-white"
        >
          <Icon className="size-6.5 stroke-[1.75]" />
        </span>

        {isFeatured ? (
          <span className="inline-flex items-center rounded-full bg-brand-accent-tint px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-brand-text">
            Recommended
          </span>
        ) : (
          <span
            aria-hidden="true"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-white text-brand-text shadow-2xs"
          >
            <ArrowUpRight className="size-4 stroke-[2.25]" />
          </span>
        )}
      </div>

      {/* Availability status */}
      <p className="mt-1 inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-white/80">
        <span
          aria-hidden="true"
          className="size-2 rounded-full bg-emerald-400"
        />
        <span>Available</span>
      </p>

      {/* Title & subtitle */}
      <div className="space-y-2">
        <h3
          id={titleId}
          className="text-xl font-bold leading-snug tracking-tight text-white"
        >
          {exam.name}
        </h3>

        <p className="text-sm leading-6 text-indigo-100/80">
          {exam.certification_name} · {exam.category_name}
        </p>
      </div>

      {/* Question count stat */}
      <div className="mt-1">
        <p className="text-3xl font-bold leading-none tracking-tight text-white">
          {exam.question_count}
        </p>
        <p className="mt-1 text-xs font-medium text-white/70">questions</p>
      </div>

      {/* Footer action */}
      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
        <span className="text-xs text-white/70">From the approved bank</span>

        <button
          type="button"
          aria-label={`Start exam — ${exam.name}`}
          disabled={isStarting}
          onClick={() => onStartExam(exam)}
          className={`inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold transition-colors focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#19184d] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
            isFeatured
              ? "bg-brand-accent text-brand-text shadow-sm hover:bg-brand-accent/90"
              : "bg-white text-brand-primary shadow-2xs hover:bg-brand-surface"
          }`}
        >
          <span>{isStarting ? "Starting..." : "Start exam"}</span>
          <ArrowRight aria-hidden="true" className="size-4 stroke-[2.25]" />
        </button>
      </div>
    </article>
  );
}