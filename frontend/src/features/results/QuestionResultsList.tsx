import type { QuestionResult } from "@/types/exam-api.types";

interface QuestionResultsListProps {
  questions: QuestionResult[];
}

const statusLabels: Record<QuestionResult["status"], string> = {
  graded: "Graded",
  pending_manual_grading: "Awaiting manual review",
  unavailable: "Not graded",
};

export default function QuestionResultsList({
  questions,
}: QuestionResultsListProps) {
  if (questions.length === 0) return null;

  return (
    <section
      aria-labelledby="question-results-heading"
      className="rounded-md border border-[#cbd0d3] bg-white p-5"
    >
      <h2
        id="question-results-heading"
        className="text-lg font-bold text-[#303639]"
      >
        Question breakdown
      </h2>
      <ul className="mt-4 space-y-4">
        {questions.map((question) => (
          <li
            key={question.question_version_id}
            className="rounded-md border border-[#e2e5e7] p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="text-sm font-semibold text-[#303639]">
                Question {question.position}
              </p>
              <p
                className={`text-xs font-semibold uppercase tracking-wide ${
                  question.status === "graded"
                    ? "text-emerald-700"
                    : question.status === "pending_manual_grading"
                      ? "text-amber-700"
                      : "text-[#687178]"
                }`}
              >
                {statusLabels[question.status]}
              </p>
            </div>
            <p className="mt-2 text-sm leading-6 text-[#303639]">
              {question.question_text}
            </p>
            {question.learner_response && (
              <p className="mt-2 rounded-md bg-[#f8f9fa] p-3 text-sm leading-6 text-[#687178]">
                Your response: {question.learner_response}
              </p>
            )}
            {question.status === "graded" && (
              <p className="mt-2 text-sm font-medium text-[#303639]">
                Score: {question.points_earned}/{question.max_points}
              </p>
            )}
            {question.status === "pending_manual_grading" && (
              <p className="mt-2 text-sm text-[#687178]">
                A final human grade is still pending for this response.
              </p>
            )}
            {question.status === "unavailable" && (
              <p className="mt-2 text-sm text-[#687178]">
                This question has no gradable response and is not counted as a
                failure.
              </p>
            )}
            {question.feedback && (
              <p className="mt-2 text-sm leading-6 text-[#303639]">
                Feedback: {question.feedback}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
