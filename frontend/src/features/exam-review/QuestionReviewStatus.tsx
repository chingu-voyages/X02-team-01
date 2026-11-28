import { CheckCircle2, ClipboardCheck, Clock, FileQuestion, Minus, XCircle, type LucideIcon } from "lucide-react";
import type { ReviewStatus } from "@/types/exam-review.types";

export const statusInfo = {
  correct: { label: "Correct", Icon: CheckCircle2, color: "bg-emerald-50 text-emerald-800" },
  incorrect: { label: "Incorrect", Icon: XCircle, color: "bg-red-50 text-red-800" },
  unanswered: { label: "Unanswered", Icon: Minus, color: "bg-slate-100 text-slate-800" },
  pending_manual_grading: { label: "Pending Grading", Icon: Clock, color: "bg-amber-50 text-amber-900" },
  manually_graded: { label: "Manually graded", Icon: ClipboardCheck, color: "bg-blue-50 text-blue-900" },
  unavailable: { label: "Not graded", Icon: FileQuestion, color: "bg-slate-100 text-slate-800" },
} satisfies Record<ReviewStatus, { label: string; Icon: LucideIcon; color: string }>;

export default function QuestionReviewStatus({ status }: { status: ReviewStatus }) {
  const { label, Icon, color } = statusInfo[status];
  return (
    <span className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold ${color}`}>
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
