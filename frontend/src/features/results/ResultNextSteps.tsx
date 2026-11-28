
import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ResultNextStepsProps {
  onReviewAnswers?: () => void;
  reviewHref?: string;
}

export default function ResultNextSteps({
  onReviewAnswers,
  reviewHref,
}: ResultNextStepsProps) {
  const canReview = Boolean(reviewHref || onReviewAnswers);
  const reviewClassName =
    "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-primary px-5 py-2 text-center text-sm font-semibold text-white shadow-xs transition-colors hover:bg-brand-primary-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary sm:w-auto";

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
        {canReview
          ? "Browse your completed questions and see which responses need another look."
          : "Return to practice exams when you are ready to continue learning."}
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {reviewHref ? (
          <Link href={reviewHref} className={reviewClassName}>
            <ClipboardCheck aria-hidden="true" className="size-4 shrink-0" />
            Review Answers
          </Link>
        ) : onReviewAnswers ? (
          <Button
            type="button"
            onClick={onReviewAnswers}
            className={reviewClassName}
          >
            <ClipboardCheck aria-hidden="true" className="size-4 shrink-0" />
            Review Answers
          </Button>
        ) : null}

        <Link
          href="/categories"
          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-brand-primary/35 bg-white px-5 py-2 text-center text-sm font-semibold text-brand-primary shadow-2xs transition-colors hover:border-brand-primary hover:bg-brand-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary sm:w-auto"
        >
          Back to practice exams
        </Link>
      </div>
    </section>
  );
}
