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
  if (
    scorePercent === null ||
    isPassed === null ||
    passingScorePercent === null
  ) {
    return (
      <Card>
        <PageHeader title="Exam Result Unavailable" />
        <p className="text-gray-500">Unable to load exam performance data.</p>
      </Card>
    );
  }

  const formattedScore = scorePercent.toFixed(2);

  return (
    <div>
      <Card>
        <PageHeader title="Practice exam complete" />
        <div className="flex">
          <Card className="w-full flex flex-col">
            <span className="text-sm text-gray-500">Score</span>{" "}
            <span className="text-2xl font-bold">{formattedScore}%</span>
          </Card>
          <Card className="w-full flex flex-col">
            <span className="text-sm text-gray-500">Correct</span>
            <span className="text-2xl font-bold">{correctCount}</span>
          </Card>
          <Card className="w-full flex flex-col">
            <span className="text-sm text-gray-500">Incorrect</span>
            <span className="text-2xl font-bold">{incorrectCount}</span>
          </Card>
        </div>
        <Card className="flex items-center">
          <div className="flex flex-col flex-1">
            <span className="text-sm text-gray-500">Exam result</span>
            <span
              role="status"
              aria-live="polite"
              className="text-2xl font-bold"
            >
              {isPassed ? "Passed" : "Failed"}
            </span>
          </div>
          <div className="flex-1">
            scored {formattedScore}% <span aria-hidden="true">·</span>{" "}
            {passingScorePercent}% required to pass
          </div>
        </Card>
      </Card>
    </div>
  );
}
