"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import {
  getManagedQuestion,
  publishManagedQuestion,
  rejectManagedQuestion,
  requestQuestionChanges,
  retireManagedQuestion,
  startQuestionReview,
  submitManagedQuestion,
} from "@/lib/admin-question-api";
import type { AdminQuestionDetail } from "@/types/admin-question-api.types";

type Role = "learner" | "contributor" | "administrator" | null;
type Action = "submit" | "start" | "publish" | "changes" | "reject" | "retire";

type Props = {
  question: AdminQuestionDetail;
  role: Role;
  userId: string | null;
  token: string;
  onUpdated: (question: AdminQuestionDetail) => void;
  onUnauthorized: (error: ApiError) => void;
  onReload: () => void;
};

const actions: Record<Action, { label: string; busy: string; title: string; description: string; success: string }> = {
  submit: {
    label: "Submit for Review", busy: "Submitting...", title: "Submit for review?",
    description: "Send this draft to an administrator. Submission does not publish the question.",
    success: "Question submitted for review.",
  },
  start: {
    label: "Start Review", busy: "Starting...", title: "Start review?",
    description: "Mark this submission as in review.", success: "Review started.",
  },
  publish: {
    label: "Approve & Publish", busy: "Publishing...", title: "Approve and publish question?",
    description: "This version will become available for future practice exams, subject to question eligibility. Existing learner attempts keep their original question versions.",
    success: "Question approved and published.",
  },
  changes: {
    label: "Request Changes", busy: "Returning...", title: "Request changes?",
    description: "Return this question to an editable draft with feedback for its author. This version will remain unpublished.",
    success: "Changes requested. The question has returned to draft.",
  },
  reject: {
    label: "Reject", busy: "Rejecting...", title: "Reject question?",
    description: "This version will be retained as inactive and cannot be edited or published through the normal draft workflow. Any earlier active version is preserved.",
    success: "Question rejected and retained as inactive.",
  },
  retire: {
    label: "Retire", busy: "Retiring...", title: "Retire question?",
    description: "Exclude this question from future exams. Previous learner attempts retain their pinned question versions, answers and results.",
    success: "Question retired.",
  },
};

const primaryButton = "inline-flex min-h-11 w-full items-center justify-center rounded-md bg-[#3d4145] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#292d30] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto";
const secondaryButton = "inline-flex min-h-11 w-full items-center justify-center rounded-md border border-[#cfd2d5] bg-white px-4 py-2.5 text-sm font-medium text-[#292d30] hover:bg-[#f4f4f4] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto";
const destructiveButton = "inline-flex min-h-11 w-full items-center justify-center rounded-md border border-red-300 bg-white px-4 py-2.5 text-sm font-semibold text-red-800 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto";

type Problem = { message: string; refresh: boolean; reason?: boolean };

function describeProblem(error: unknown, action: Action): Problem {
  if (error instanceof ApiError) {
    if (error.status === 403) return { message: "You no longer have permission to perform this action. Reload the question to check its current state.", refresh: true };
    if (error.status === 404 || error.status === 409) return { message: "The question is no longer available in this state. Reload its details before trying again.", refresh: true };
    if (error.status === 422 && (action === "changes" || action === "reject")) return { message: "Enter a valid review reason of no more than 2,000 characters.", refresh: false, reason: true };
    if (error.status === 422) return { message: "The question could not be validated. Check its details before trying again.", refresh: true };
  }
  return { message: "We could not confirm the action. Reload the question to check whether it succeeded before trying again.", refresh: true };
}

function ActionDialog({ action, question, busy, reason, problem, setReason, onCancel, onConfirm, onReload }: {
  action: Action;
  question: AdminQuestionDetail;
  busy: boolean;
  reason: string;
  problem: Problem | null;
  setReason: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  onReload: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const problemRef = useRef<HTMLParagraphElement>(null);
  const needsReason = action === "changes" || action === "reject";

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    if (busy) dialogRef.current?.focus();
    else if (problem?.reason) reasonRef.current?.focus();
    else if (problem) problemRef.current?.focus();
  }, [busy, problem]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!busy) onCancel();
    }
    if (event.key !== "Tab") return;
    const elements = dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), textarea:not(:disabled)");
    if (!elements || elements.length === 0) { event.preventDefault(); return; }
    const first = elements[0];
    const last = elements[elements.length - 1];
    const focused = document.activeElement;
    if (!Array.from(elements).some((item) => item === focused) || (event.shiftKey && focused === first) || (!event.shiftKey && focused === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 sm:p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-busy={busy} aria-labelledby="review-action-title" aria-describedby="review-action-description" tabIndex={-1} onKeyDown={handleKeyDown} className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-lg border border-[#cfd2d5] bg-white p-4 shadow-xl outline-none sm:p-6">
        <h2 id="review-action-title" className="text-xl font-bold">{actions[action].title}</h2>
        <p className="mt-2 text-sm font-medium [overflow-wrap:anywhere]">{question.question_text}</p>
        <p id="review-action-description" className="mt-3 text-sm leading-6 text-[#4f565b]">{actions[action].description}</p>
        {needsReason && (
          <div className="mt-4">
            <label htmlFor="review-reason" className="block text-sm font-semibold">Review reason (required)</label>
            <textarea ref={reasonRef} id="review-reason" rows={5} maxLength={2000} required value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} aria-invalid={problem?.reason || undefined} aria-describedby={problem?.reason ? "review-reason-help review-action-error" : "review-reason-help"} className="mt-2 w-full min-w-0 resize-y rounded-md border border-[#cfd2d5] px-3 py-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 aria-invalid:border-red-600 sm:text-sm" />
            <p id="review-reason-help" className="mt-1 text-xs text-[#4f565b]">Explain the outcome clearly. {reason.length}/2,000 characters.</p>
          </div>
        )}
        {problem && <p id="review-action-error" ref={problemRef} tabIndex={-1} role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-5 text-red-800 [overflow-wrap:anywhere]">{problem.message}</p>}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button ref={cancelRef} type="button" disabled={busy} onClick={onCancel} className={secondaryButton}>Cancel</button>
          {problem?.refresh ? (
            <button type="button" disabled={busy} onClick={onReload} className={primaryButton}>Reload details</button>
          ) : (
            <button type="button" disabled={busy} onClick={onConfirm} className={action === "reject" || action === "retire" ? `${primaryButton} !bg-red-700 hover:!bg-red-800` : primaryButton}>{busy ? actions[action].busy : action === "publish" ? "Confirm publish" : action === "reject" ? "Confirm rejection" : action === "retire" ? "Confirm retirement" : "Send feedback"}</button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function QuestionReviewActions({ question, role, userId, token, onUpdated, onUnauthorized, onReload }: Props) {
  const [pending, setPending] = useState<Action | null>(null);
  const [busyAction, setBusyAction] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [success, setSuccess] = useState("");
  const inFlight = useRef(false);
  const active = useRef(true);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const busy = busyAction !== null;

  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { if (success && !busy && !pending) headingRef.current?.focus(); }, [success, busy, pending]);
  useEffect(() => { if (problem && !busy && !pending) errorRef.current?.focus(); }, [problem, busy, pending]);

  useEffect(() => {
    if (!pending && !busy && restoreFocus.current) {
      restoreFocus.current = false;
      if (!problem?.refresh && triggerRef.current?.isConnected) triggerRef.current.focus();
    }
  }, [pending, busy, problem]);

  const admin = role === "administrator";
  const owner = role === "contributor" && Boolean(userId) && userId === question.created_by_id;
  const rejected = question.review_status === "rejected" || question.publication_status === "inactive";
  const retired = question.publication_status === "retired";
  const published = question.publication_status === "active";
  const draft = !rejected && question.publication_status === "draft" && question.review_status === "pending";
  const submitted = !rejected && question.publication_status === "draft" && question.review_status === "submitted";
  const reviewing = !rejected && question.publication_status === "draft" && question.review_status === "in_review";
  const canEdit = !rejected && !retired && ((draft && (admin || owner)) || (published && admin));
  const available: Action[] = [];
  if (!rejected && !retired) {
    if (owner && draft) available.push("submit");
    if (admin && submitted) available.push("start");
    if (admin && (draft || reviewing)) available.push("publish");
    if (admin && reviewing) available.push("changes", "reject");
    if (admin && published) available.push("retire");
  }
  const guidance = retired ? "Retired — excluded from future practice exams. Historical attempts are preserved."
    : rejected ? "Rejected / inactive — retained as a read-only record. This version cannot be published."
    : published ? "Published — this version is available for eligible future exams."
    : submitted ? admin ? "Submitted — select Start Review before making a review decision." : "Submitted — waiting for an administrator to start review."
    : reviewing ? admin ? "In Review — approve and publish, request changes, or reject with a reason." : "In Review — an administrator is reviewing your submission."
    : draft ? question.review_note ? "Changes requested — review the feedback before editing or resubmitting." : admin ? "Draft — check the question and publish it when ready." : "Draft — save your changes, then submit for administrator review."
    : "This version has no available workflow actions in its current state.";

  function reload() { if (!inFlight.current) { setPending(null); onReload(); } }
  function cancel() {
    if (!inFlight.current) {
      restoreFocus.current = true;
      setPending(null);
      setReason("");
      if (!problem?.refresh) setProblem(null);
    }
  }

  async function run(action: Action) {
    if (inFlight.current || problem?.refresh || !available.includes(action)) return;
    const trimmedReason = reason.trim();
    if ((action === "changes" || action === "reject") && (!trimmedReason || trimmedReason.length > 2000)) {
      setProblem({ message: "Enter a review reason of 1–2,000 characters.", refresh: false, reason: true });
      return;
    }
    inFlight.current = true;
    setBusyAction(action);
    setProblem(null);
    setSuccess("");
    try {
      let updated: AdminQuestionDetail;
      switch (action) {
        case "submit": updated = await submitManagedQuestion(token, question.question_id); break;
        case "start": updated = await startQuestionReview(token, question.question_id); break;
        case "publish": updated = await publishManagedQuestion(token, question.question_id); break;
        case "changes": updated = await requestQuestionChanges(token, question.question_id, trimmedReason); break;
        case "reject": updated = await rejectManagedQuestion(token, question.question_id, trimmedReason); break;
        case "retire":
          await retireManagedQuestion(token, question.question_id);
          updated = await getManagedQuestion(token, question.question_id);
          break;
      }
      if (!active.current) return;
      if (updated.question_id !== question.question_id) throw new Error("Unexpected question response");
      onUpdated(updated);
      setPending(null);
      setReason("");
      setSuccess(actions[action].success);
    } catch (error: unknown) {
      if (!active.current) return;
      if (error instanceof ApiError && error.status === 401) { onUnauthorized(error); return; }
      setProblem(describeProblem(error, action));
    } finally {
      inFlight.current = false;
      if (active.current) setBusyAction(null);
    }
  }

  function choose(action: Action, trigger: HTMLButtonElement) {
    if (inFlight.current || pending || problem?.refresh || !available.includes(action)) return;
    if (action === "submit" || action === "start") { void run(action); return; }
    triggerRef.current = trigger;
    setReason("");
    setProblem(null);
    setSuccess("");
    setPending(action);
  }

  const locked = busy || pending !== null || Boolean(problem?.refresh);
  return (
    <div className="mb-5 min-w-0 space-y-4">
      <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold tracking-tight [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-offset-2 sm:text-3xl">Question Details — Q-{question.question_id.replace(/-/g, "").slice(0, 8).toUpperCase()}</h1>
        {(canEdit || available.length > 0) && <div className="flex min-w-0 flex-col flex-wrap gap-2 sm:flex-row xl:justify-end" aria-label="Question actions" role="group">
          {canEdit && (locked ? <button type="button" disabled className={secondaryButton}>Edit</button> : <Link href={`/admin/questions/${encodeURIComponent(question.question_id)}/edit`} className={secondaryButton}>Edit</Link>)}
          {available.map((action) => <button key={action} type="button" disabled={locked} onClick={(event) => choose(action, event.currentTarget)} className={action === "reject" || action === "retire" ? destructiveButton : action === "changes" ? secondaryButton : primaryButton}>{busyAction === action ? actions[action].busy : actions[action].label}</button>)}
        </div>}
      </div>
      <div className={`flex min-w-0 items-start gap-2 rounded-md border p-4 text-sm leading-6 ${rejected ? "border-red-200 bg-red-50 text-red-900" : published ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-[#d4d7da] bg-[#f1f1f1] text-[#414b52]"}`}>
        {published ? <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0" /> : <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />}
        <p className="min-w-0 font-medium [overflow-wrap:anywhere]">{guidance}</p>
      </div>
      {question.review_note && <div className="rounded-md border border-[#cfd2d5] bg-white p-4 text-sm"><p className="font-semibold">Administrator feedback</p><p className="mt-2 whitespace-pre-wrap leading-6 [overflow-wrap:anywhere]">{question.review_note}</p></div>}
      {success && <div role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{success}</div>}
      {problem && !pending && <div ref={errorRef} tabIndex={-1} role="alert" className="space-y-3 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800"><p>{problem.message}</p>{problem.refresh && <button type="button" onClick={reload} className={secondaryButton}>Reload details</button>}</div>}
      {pending && <ActionDialog action={pending} question={question} busy={busy} reason={reason} problem={problem} setReason={(value) => { setReason(value); if (problem?.reason) setProblem(null); }} onCancel={cancel} onConfirm={() => void run(pending)} onReload={reload} />}
    </div>
  );
}
