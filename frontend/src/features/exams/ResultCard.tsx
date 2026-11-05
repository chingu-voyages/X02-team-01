import PageHeader from "@/components/layouts/PageHeader";
import Card from "@/components/ui/Card";

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
  const hasScore = scorePercent !== null && isPassed !== null;

  const formattedScore =
    scorePercent === null
      ? "—"
      : `${scorePercent.toFixed(1)}%`;

  const resultLabel =
    isPassed === null
      ? "Not assessed"
      : isPassed
        ? "Passed"
        : "Not passed";

  return (
    <Card className="mx-auto w-full max-w-3xl rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <div className="space-y-6">
        <div>
          <PageHeader title="Practice exam complete" />

          <p className="mt-2 text-sm text-gray-500">
            Here is your practice exam performance.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-5">
            <p className="text-sm font-medium text-gray-500">
              Score
            </p>
            <p className="mt-2 text-3xl font-bold text-gray-900">
              {formattedScore}
            </p>
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-5">
            <p className="text-sm font-medium text-gray-500">
              Correct
            </p>
            <p className="mt-2 text-3xl font-bold text-gray-900">
              {correctCount}
            </p>
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-5">
            <p className="text-sm font-medium text-gray-500">
              Incorrect
            </p>
            <p className="mt-2 text-3xl font-bold text-gray-900">
              {incorrectCount}
            </p>
          </div>
        </div>

        <div
          role="status"
          className={`rounded-lg border p-5 ${
            isPassed === true
              ? "border-green-200 bg-green-50"
              : isPassed === false
                ? "border-red-200 bg-red-50"
                : "border-gray-200 bg-gray-50"
          }`}
        >
          <p className="text-sm font-medium text-gray-600">
            Exam result
          </p>

          <p className="mt-2 text-2xl font-bold text-gray-900">
            {resultLabel}
          </p>

          {passingScorePercent !== null && (
            <p className="mt-2 text-sm text-gray-600">
              {passingScorePercent}% required to pass
            </p>
          )}
        </div>

        {!hasScore && (
          <p className="text-sm text-gray-600">
            No automatically graded score is available for
            this attempt. This does not mean the exam was failed.
          </p>
        )}
      </div>
    </Card>
  );
}
