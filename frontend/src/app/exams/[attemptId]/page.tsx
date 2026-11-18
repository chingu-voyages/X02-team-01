import ExamCard from "@/features/exams/ExamCard";

// Preserve the existing dynamic attempt page. Styling matches /categories and
// /exams/[attemptId]/results without changing the API or routing behavior.
export const instant = false;

export default async function ExamPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;

  return (
    <main
      className="min-h-screen bg-[#f3f4f5] px-4 py-6 text-[#303639] sm:px-6 lg:px-8"
      style={{ fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      <div className="mx-auto max-w-7xl">
        <ExamCard attemptId={attemptId} />
      </div>
    </main>
  );
}
