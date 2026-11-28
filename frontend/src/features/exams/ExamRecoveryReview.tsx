"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ExamQuestionWithResponse } from "@/types/exam-api.types";
import type { RecoveryCopy } from "@/lib/exam-recovery-journal";

type Props = {
  copies: RecoveryCopy[];
  questions: ExamQuestionWithResponse[];
  error: string;
  onRestore: (key: string) => void;
  onDiscard: (key: string) => void;
  onContinue: () => void;
  onReload: () => void;
};

/** Review local work separately from the server's authoritative attempt. */
export default function ExamRecoveryReview({ copies, questions, error, onRestore, onDiscard, onContinue, onReload }: Props) {
  const [discardKey, setDiscardKey] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return (
    <section aria-labelledby="recovery-heading" className="min-w-0 space-y-4 rounded-2xl border border-brand-border bg-white p-4 text-brand-text sm:p-6">
      <div className="space-y-2">
        <h1 ref={heading} tabIndex={-1} id="recovery-heading" className="text-xl font-bold focus-visible:outline-2 focus-visible:outline-brand-primary">Recover unsaved progress</h1>
        <p className="text-sm leading-6">We found unfinished changes on this device. Review them before continuing. Your server-saved answers and submitted answers are protected.</p>
      </div>
      {error && (
        <div role="alert" className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <p>{error}</p>
          <Button type="button" variant="outline" onClick={onReload} className="min-h-11 w-full sm:w-auto">Reload saved progress</Button>
        </div>
      )}
      {copies.map((copy, index) => (
        <article key={copy.key} aria-label={`Device copy ${index + 1}`} className="min-w-0 space-y-3 rounded-xl border border-brand-border p-4">
          <div className="space-y-1">
            <h2 className="font-semibold">{copy.canRestore ? "Ready to restore" : "Saved progress has changed"}</h2>
            <p className="text-xs text-brand-text/75">Device copy from {new Date(copy.updatedAt).toLocaleString()}</p>
            {!copy.canRestore && <p className="text-sm leading-5">To protect newer or locked answers, this copy cannot be applied automatically. You can review and copy the text below, or continue with the saved exam.</p>}
          </div>
          <div className="space-y-3">
            {copy.operations.map((operation) => {
              if (operation.kind === "position") return <p key="position" className="text-sm font-medium">Saved device position: question {operation.currentPosition}</p>;
              const question = questions.find((item) => item.id === operation.questionVersionId);
              const options = (operation.answer.selected_option_ids ?? []).map((id) => question?.options.find((option) => option.id === id)?.option_text ?? "Unavailable selection");
              const savedOptions = (question?.response?.selected_option_ids ?? []).map((id) => question?.options.find((option) => option.id === id)?.option_text ?? "Unavailable selection");
              const local = operation.answer.text_response || options.join("; ") || "No answer (cleared)";
              const saved = question?.response?.text_response || savedOptions.join("; ") || "No saved answer";
              return (
                <div key={operation.questionVersionId} className="min-w-0 space-y-2 rounded-lg bg-brand-surface p-3 text-sm">
                  <h3 className="wrap-anywhere font-semibold">{question ? `Question ${question.position}: ${question.question_text}` : "Question no longer available"}</h3>
                  <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                    <div className="min-w-0 space-y-1 rounded-md bg-white p-3">
                      <p className="text-xs font-semibold">Device copy</p>
                      <p className="wrap-anywhere whitespace-pre-wrap">{local}</p>
                    </div>
                    <div className="min-w-0 space-y-1 rounded-md bg-white p-3">
                      <p className="text-xs font-semibold">Server saved{question?.response?.is_submitted ? " · Submitted (locked)" : ""}</p>
                      <p className="wrap-anywhere whitespace-pre-wrap">{saved}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {discardKey === copy.key ? (
            <div className="space-y-2 rounded-lg border border-brand-border p-3">
              <p className="text-sm">Discard this device copy? Any changes not saved to the server in this copy will be lost.</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="button" variant="outline" onClick={() => setDiscardKey(null)} className="min-h-11 w-full sm:w-auto">Cancel</Button>
                <Button type="button" variant="outline" onClick={() => { onDiscard(copy.key); setDiscardKey(null); }} className="min-h-11 w-full border-red-300 text-red-800 sm:w-auto">Confirm discard</Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {copy.canRestore && <Button type="button" onClick={() => onRestore(copy.key)} className="min-h-11 w-full sm:w-auto">Restore this copy</Button>}
              <Button type="button" variant="outline" onClick={() => setDiscardKey(copy.key)} className="min-h-11 w-full sm:w-auto">Discard device copy</Button>
            </div>
          )}
        </article>
      ))}
      <Button type="button" variant="outline" onClick={onContinue} className="min-h-11 w-full sm:w-auto">Continue with saved progress</Button>
      <p className="text-xs leading-5 text-brand-text/75">Continuing without restoring keeps the device copy for later review. Device copies are not encrypted, and expire from recovery after seven days. Use a trusted device.</p>
    </section>
  );
}
