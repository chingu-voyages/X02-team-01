import { ArrowRight } from "lucide-react";
import { useId } from "react";
import type { UnfinishedExam } from "@/lib/unfinished-exams-api";

interface Props {
  attempt: UnfinishedExam;
  disabled: boolean;
  onContinue: () => void;
}

export default function UnfinishedExamCard({ attempt, disabled, onContinue }: Props) {
  const titleId = useId();
  const detailsId = `${titleId}-details`;
  const name = attempt.name || `${attempt.certification_name} practice exam`;
  const count = `${attempt.submitted_count} of ${attempt.question_count} questions submitted`;
  const percent = Math.round(100 * attempt.submitted_count / attempt.question_count);
  const completed = attempt.submitted_count === attempt.question_count;
  const started = new Date(attempt.started_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  return (
    <article aria-labelledby={titleId} className="flex min-w-0 flex-col gap-3 rounded-2xl border border-brand-primary/25 bg-white p-4 text-brand-text shadow-xs sm:p-5">
      <p className="text-xs font-bold uppercase tracking-wide text-brand-primary">In progress</p>
      <h3 id={titleId} className="wrap-anywhere text-lg font-bold leading-snug">{name}</h3>
      <p className="wrap-anywhere text-sm text-brand-text/80">{attempt.certification_name}{attempt.category_name ? ` · ${attempt.category_name}` : ""}</p>
      <div id={detailsId} className="space-y-2 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>{count}</span><span className="font-semibold tabular-nums">{percent}%</span>
        </div>
        <div role="progressbar" aria-label={`Submitted progress — ${name}`} aria-valuemin={0} aria-valuemax={attempt.question_count} aria-valuenow={attempt.submitted_count} aria-valuetext={count} className="h-2 w-full overflow-hidden rounded-full bg-brand-surface">
          <div className="h-full rounded-full bg-brand-primary" style={{ width: `${percent}%` }} />
        </div>
        <p className="font-medium">{completed ? "All answers submitted. Finish your exam." : `Resume at question ${attempt.current_position}`}</p>
        <p className="text-xs text-brand-text/75">Started {started}</p>
      </div>
      <button type="button" aria-label={`Continue exam — ${name}`} aria-describedby={detailsId} disabled={disabled} onClick={onContinue}
        className="mt-auto inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-brand-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-primary-dark focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60">
        Continue exam <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
      </button>
    </article>
  );
}
