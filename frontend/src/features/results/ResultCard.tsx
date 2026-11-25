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
}

export default function ResultCard({
  scorePercent,
  correctCount,
  incorrectCount,
  isPassed,
  passingScorePercent,
  categoryTitle = "Agile Fundamentals",
  onReviewAnswers,
}: ResultCardProps) {
  const totalQuestions = correctCount + incorrectCount;

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
          Practice exam complete
        </h1>

        <p className="text-sm text-brand-text/70">
          Results are based on automatically graded multiple-choice answers.
        </p>
      </header>

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
      />

      <ResultNextSteps onReviewAnswers={onReviewAnswers} />
    </section>
  );
}