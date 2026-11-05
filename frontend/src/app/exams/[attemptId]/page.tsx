import ExamCard from "@/features/exams/ExamCard";

// The exam interface is learner- and session-specific: it must not be
// prerendered. Blocking prerender keeps the attemptId params access out of
// the static build (the exam itself renders after the client-side session
// check; ExamCard below is a Client Component).
export const instant = false;

export default async function ExamPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;

  return (
    <main className="p-4 sm:p-6">
      <ExamCard attemptId={attemptId} />
    </main>
  );
}
