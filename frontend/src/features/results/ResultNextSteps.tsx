
import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ResultNextStepsProps {
  onReviewAnswers?: () => void;
}

export default function ResultNextSteps({
  onReviewAnswers,
}: ResultNextStepsProps) {
  return (
    <section
      aria-labelledby="next-step-heading"
      className="rounded-2xl border border-brand-accent/35 bg-linear-to-r from-brand-accent-tint via-[#fff3e6] to-[#f8d7b8] p-6 sm:p-7"
    >
      <h2
        id="next-step-heading"
        className="text-xs font-bold uppercase tracking-wider text-amber-900"
      >
        Next step
      </h2>

      <p className="mt-1.5 text-sm text-brand-text/85">
        Go through each answer with its explanation to see where points were
        lost.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={onReviewAnswers}
          className="min-h-11 cursor-pointer rounded-xl bg-brand-primary px-5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-brand-primary-dark"
        >
          <ClipboardCheck aria-hidden="true" className="size-4" />
          Review Answers
        </Button>

        <Link
          href="/categories"
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-brand-primary/35 bg-white px-5 text-sm font-semibold text-brand-primary shadow-2xs transition-colors hover:border-brand-primary hover:bg-brand-surface"
        >
          Back to practice exams
        </Link>
      </div>
    </section>
  );
}
