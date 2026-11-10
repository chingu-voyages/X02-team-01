import Navbar from "@/components/layouts/Navbar";

interface ResultCardProps {
  scorePercent: number | null;
  correctCount: number;
  incorrectCount: number;
  isPassed: boolean | null;
  passingScorePercent: number | null;
}

export default function ResultCard({
  scorePercent,
  correctCount,
  incorrectCount,
  isPassed,
  passingScorePercent,
}: ResultCardProps) {
  const hasScore =
    scorePercent !== null && isPassed !== null;

  const formattedScore =
    scorePercent === null
      ? "—"
      : `${Math.round(scorePercent)}%`;

  const resultLabel = !hasScore
    ? "Not assessed"
    : isPassed
      ? "Passed"
      : "Not passed";

  return (
    <section
      aria-labelledby="results-heading"
      className="w-full space-y-6 text-[#303639]"
    >
      {/* Navigation — same as category page */}
      <Navbar />

      {/* Heading */}
      <header className="space-y-2">
        <h1
          id="results-heading"
          className="text-2xl font-bold tracking-tight sm:text-3xl"
        >
          Practice exam complete
        </h1>

        <p className="text-sm text-[#687178]">
          Your results are based on automatically graded
          multiple-choice answers.
        </p>
      </header>

      {/* Full-width statistics */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <div className="rounded-md border border-[#cbd0d3] bg-white p-6">
          <p className="text-xs font-medium uppercase text-[#687178]">
            Score
          </p>

          <p className="mt-3 text-3xl font-bold">
            {formattedScore}
          </p>
        </div>

        <div className="rounded-md border border-[#cbd0d3] bg-white p-6">
          <p className="text-xs font-medium uppercase text-[#687178]">
            Correct
          </p>

          <p className="mt-3 text-3xl font-bold">
            {correctCount}
          </p>
        </div>

        <div className="rounded-md border border-[#cbd0d3] bg-white p-6">
          <p className="text-xs font-medium uppercase text-[#687178]">
            Incorrect
          </p>

          <p className="mt-3 text-3xl font-bold">
            {incorrectCount}
          </p>
        </div>
      </div>

      {/* Wide result summary */}
      <div className="grid grid-cols-1 gap-4 rounded-md border border-[#cbd0d3] bg-[#f8f9fa] p-4 md:grid-cols-3">
        <div className="bg-white p-5 md:col-span-1">
          <p className="text-xs font-medium uppercase text-[#687178]">
            Exam Result
          </p>

          <p
            role="status"
            className="mt-3 text-3xl font-bold uppercase"
          >
            {resultLabel}
          </p>
        </div>

        <div className="flex flex-col justify-center bg-white p-5 md:col-span-2">
          <p className="text-lg font-bold">
            {scorePercent !== null
              ? `${formattedScore} scored`
              : "Score unavailable"}

            {passingScorePercent !== null && (
              <>
                <span
                  className="mx-2 text-gray-500"
                  aria-hidden="true"
                >
                  •
                </span>
                <span>
                  {passingScorePercent}% required to pass
                </span>
              </>
            )}
          </p>

          <p className="mt-2 text-sm text-[#687178]">
            The result is calculated using the passing
            threshold configured for this exam.
          </p>
        </div>
      </div>

      {/* Supporting information */}
      <div className="rounded-md border border-[#cbd0d3] bg-[#f8f9fa] p-5">
        <p className="text-xs font-semibold uppercase text-[#687178]">
          About your result
        </p>

        <p className="mt-2 text-sm leading-6 text-[#687178]">
          Scores reflect automatically graded questions.
          Your passing requirement and final pass/fail
          result come directly from the backend.
        </p>

        {!hasScore && (
          <p className="mt-3 text-sm text-[#687178]">
            No automatically graded score is available
            for this attempt. This does not mean the
            exam was failed.
          </p>
        )}
      </div>
    </section>
  );
}
