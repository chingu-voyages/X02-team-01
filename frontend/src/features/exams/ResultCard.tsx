import PageHeader from "@/components/layouts/PageHeader";
import Card from "@/components/ui/Card";

export default function ResultCard() {
  return (
    <div>
      <Card>
        <PageHeader title="Practice exam complete" />
        <div className="flex">
          <Card>Score: 80%</Card>
          <Card>Correct: 8</Card>
          <Card>Incorect: 2</Card>
        </div>
        <Card>Result</Card>
      </Card>
    </div>
  );
}
