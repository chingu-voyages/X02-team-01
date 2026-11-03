import PageHeader from "@/components/layouts/PageHeader";
import Card from "@/components/ui/Card";

interface ResultCardProps {
  scorePercent: number;
  correctCount: number;
  incorrectCount: number;
  isPassed: boolean;
}

export default function ResultCard({
  scorePercent,
  correctCount,
  incorrectCount,
  isPassed,
}: ResultCardProps) {
  return (
    <div>
      <Card>
        <PageHeader title="Practice exam complete" />
        <div className="flex">
          <Card>Score: {scorePercent}%</Card>
          <Card>Correct: {correctCount}</Card>
          <Card>Incorect: {incorrectCount}</Card>
        </div>
        <Card>{isPassed ? "Passed" : "Failed"}</Card>
      </Card>
    </div>
  );
}
