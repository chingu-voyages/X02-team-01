import { Clock } from "lucide-react";
import Link from "next/link";
import CompactResultCard from "./CompactResultCard";
import ResultNextSteps from "./ResultNextSteps";
import ResultSummaryCard from "./ResultSummaryCard";

interface ResultCardProps {
  scorePercent: number | null;
  correctCount: number;
  incorrectCount: number;
  isPassed: boolean | null;
  passingScorePercent: number | null;
  categoryTitle?: string;
  onReviewAnswers?: () => void;
  isGradingComplete?: boolean;
  pendingManualGradingCount?: number;
  questionCount?: number;
  hasManualGrading?: boolean;
}

export default function ResultCard({
  scorePercent,
  correctCount,
  incorrectCount,
  isPassed,
  passingScorePercent,
  categoryTitle = "Agile Fundamentals",
  onReviewAnswers,
  isGradingComplete = true,
  pendingManualGradingCount = 0,
  questionCount,
  hasManualGrading = false,
}: ResultCardProps) {
  const totalQuestions = questionCount ?? correctCount + incorrectCount;
  const awaitingReview = !isGradingComplete;

  return (
    <section
      aria-labelledby="results-heading"
      className="w-full bg-brand-surface space-y-6 text-brand-text"
    >
      <header className="space-y-1.5">
        <p className="text-xs font-bold uppercase tracking-widest text-brand-primary">
          {categoryTitle} · Practice Exam
        </p>

        <h1
          id="results-heading"
          className="text-2xl font-bold tracking-tight text-brand-text sm:text-3xl"
        >
          {awaitingReview
            ? "Written responses awaiting review"
            : "Practice exam complete"}
        </h1>

        <p className="text-sm text-brand-text/70">
          {awaitingReview
            ? "Your final result will be available when grading is complete."
            : "Results are based on graded answers and the exam's passing threshold."}
        </p>
      </header>

      {awaitingReview ? (
        <div className="space-y-4 rounded-2xl border border-brand-border bg-white p-6 shadow-xs sm:p-8">
          <p
            role="status"
            className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-sm font-bold text-amber-800"
          >
            <Clock aria-hidden="true" className="size-4" />
            Awaiting review
          </p>
          <p className="text-sm leading-6 text-brand-text/75">
            {pendingManualGradingCount > 0
              ? `${pendingManualGradingCount} written response${pendingManualGradingCount === 1 ? "" : "s"} must receive a final human grade before the result is complete.`
              : "Grading is still in progress."}{" "}
            Your final pass/fail result is withheld until grading is complete.
          </p>
          {scorePercent !== null && (
            <p className="text-sm font-semibold text-brand-text">
              Provisional score: {Math.round(scorePercent)}% (not final)
            </p>
          )}
          <Link
            href="/categories"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-brand-primary/35 bg-white px-5 text-sm font-semibold text-brand-primary shadow-2xs transition-colors hover:border-brand-primary hover:bg-brand-surface"
          >
            Back to practice exams
          </Link>
        </div>
      ) : (
        <>
          <CompactResultCard
            scorePercent={scorePercent}
            correctCount={correctCount}
            incorrectCount={incorrectCount}
            isPassed={isPassed}
            passingScorePercent={passingScorePercent}
          />

          <ResultSummaryCard
            scorePercent={scorePercent}
            correctCount={correctCount}
            incorrectCount={incorrectCount}
            totalQuestions={totalQuestions}
            isPassed={isPassed}
            passingScorePercent={passingScorePercent}
            hasManualGrading={hasManualGrading}
          />

          <ResultNextSteps onReviewAnswers={onReviewAnswers} />
        </>
      )}
    </section>
  );
}
