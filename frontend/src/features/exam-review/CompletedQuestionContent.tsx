import { CheckCircle2, XCircle, BookOpen } from "lucide-react";
import QuestionMedia from "@/features/exams/QuestionMedia";
import type { CompletedQuestionReview } from "@/types/exam-question-review.types";

const section = "min-w-0 space-y-3 rounded-2xl border border-brand-border bg-white p-4 shadow-xs sm:p-6";
const body = "min-w-0 whitespace-pre-wrap wrap-anywhere leading-7";

export default function CompletedQuestionContent({ detail }: { detail: CompletedQuestionReview }) {
  const written = detail.question_type === "short_answer";
  const selected = new Set(detail.submitted_response?.selected_option_ids ?? []);
  const correct = new Set(detail.correct_option_ids ?? []);
  const keyAvailable = detail.correct_option_ids !== null;
  return (
    <div className="min-w-0 space-y-4">
      <section aria-labelledby="original-question-heading" className={section}>
        <p className="text-sm font-semibold text-brand-text/80">{written ? "Written response" : detail.allows_multiple_answers ? "Multiple select" : "Single answer"}</p>
        <h2 id="original-question-heading" className={`text-lg font-bold sm:text-xl ${body}`}>{detail.question_text}</h2>
        <QuestionMedia images={detail.images} />
        <h3 className="font-semibold">{written ? "Your answer" : "Answer options"}</h3>
        {!detail.submitted_response && <p className="rounded-xl bg-slate-100 p-3 text-sm font-medium text-slate-800">You did not submit an answer.</p>}
        {written ? (
          detail.submitted_response && <p className={`rounded-xl border border-brand-border bg-brand-surface p-4 ${body}`}>{detail.submitted_response.text_response}</p>
        ) : (
          <>
            <p className="text-sm leading-6 text-brand-text/80">{keyAvailable ? "Your selections and the correct answers are marked below." : "The correct answer key is unavailable for this question."}</p>
            <ol aria-label="Recorded answer options" className="min-w-0 space-y-3">
              {detail.options.map((option) => {
                const chosen = selected.has(option.id);
                const right = correct.has(option.id);
                const wrong = keyAvailable && chosen && !right;
                const appearance = right ? "border-emerald-700 bg-emerald-50" : wrong ? "border-red-700 bg-red-50" : chosen ? "border-brand-primary bg-brand-surface" : "border-brand-border bg-white";
                return (
                  <li key={option.id} value={option.position} className={`min-w-0 rounded-xl border p-3 sm:p-4 ${appearance}`}>
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="shrink-0 rounded-md bg-white/80 px-2 py-1 text-sm font-bold">{option.position <= 26 ? String.fromCharCode(64 + option.position) : option.position}</span>
                      <div className="min-w-0 flex-1 space-y-2">
                        <p className={`text-sm sm:text-base ${body}`}>{option.option_text}</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold sm:text-sm">
                          {chosen && <span>Your answer</span>}
                          {right && <span className="inline-flex items-center gap-1 text-emerald-800"><CheckCircle2 aria-hidden="true" className="size-4 shrink-0" />{chosen ? "Correct answer" : "Correct answer · Not selected"}</span>}
                          {wrong && <span className="inline-flex items-center gap-1 text-red-800"><XCircle aria-hidden="true" className="size-4 shrink-0" />Incorrect selection</span>}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
            {detail.allows_multiple_answers && <p className="text-sm leading-6 text-brand-text/80">Multiple-select questions require all correct options and no incorrect options for full credit.</p>}
          </>
        )}
      </section>
      {detail.explanation?.trim() && (
        <section aria-labelledby="explanation-heading" className={section}>
          <h2 id="explanation-heading" className="flex items-center gap-2 font-bold"><BookOpen aria-hidden="true" className="size-5 shrink-0 text-brand-primary" />Explanation</h2>
          <p className={body}>{detail.explanation}</p>
        </section>
      )}
      {written && detail.question_status === "pending_manual_grading" && <p className="rounded-xl border border-brand-border bg-white p-4 text-sm leading-6">Your answer is awaiting manual grading. Return here after it has been reviewed.</p>}
      {written && detail.question_status === "manually_graded" && detail.grading && (
        <section aria-labelledby="grading-heading" className={section}>
          <h2 id="grading-heading" className="font-bold">Grader feedback</h2>
          {detail.grading.max_points !== null && <p>Score: {detail.grading.points_earned} / {detail.grading.max_points}</p>}
          {detail.grading.feedback?.trim() && <p className={body}>{detail.grading.feedback}</p>}
        </section>
      )}
    </div>
  );
}
