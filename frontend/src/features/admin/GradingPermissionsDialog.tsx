"use client";

import { useState } from "react";
import type { AdminUserItem } from "@/lib/admin-users-api";
import AccessDialog, { AccessError, accessActions, accessPrimary, accessSecondary } from "./AccessDialog";

export type GradingSelection = { grade_short_answers: boolean; grade_essays: boolean };

type GradingPermissionsDialogProps = {
  user: AdminUserItem;
  isSubmitting: boolean;
  error: string | null;
  needsRefresh?: boolean;
  onCancel: () => void;
  onSave: (permissions: GradingSelection) => void;
};

export default function GradingPermissionsDialog({ user, isSubmitting, error, needsRefresh, onCancel, onSave }: GradingPermissionsDialogProps) {
  const [gradeShortAnswers, setGradeShortAnswers] = useState(user.grade_short_answers);
  const [gradeEssays, setGradeEssays] = useState(user.grade_essays);
  const changed = gradeShortAnswers !== user.grade_short_answers || gradeEssays !== user.grade_essays;
  const checkboxClass = "mt-0.5 size-5 shrink-0 cursor-pointer accent-[#3d4145] focus-visible:outline-2 focus-visible:outline-offset-2";
  return (
    <AccessDialog title="Written-response grading permissions" busy={isSubmitting} onCancel={onCancel}>
      <p className="text-sm leading-6 text-brand-text/75">{user.fullName} ({user.email}) — choose which response types this Contributor may review and grade. Changes apply immediately; previously recorded grades are never affected.</p>
      {error && <AccessError message={error} />}
      <fieldset disabled={isSubmitting || needsRefresh} className="min-w-0 space-y-3 disabled:opacity-70">
        <legend className="sr-only">Grading permissions</legend>
        <label className="flex min-w-0 cursor-pointer items-start gap-3 rounded-md border border-brand-border p-3 hover:bg-brand-surface">
          <input type="checkbox" checked={gradeShortAnswers} onChange={(event) => setGradeShortAnswers(event.target.checked)} className={checkboxClass} />
          <span className="min-w-0"><span className="block text-sm font-semibold">Grade short answers</span><span className="block text-xs text-brand-text/70">Review and grade learner short-answer responses.</span></span>
        </label>
        <label className="flex min-w-0 cursor-pointer items-start gap-3 rounded-md border border-brand-border p-3 hover:bg-brand-surface">
          <input type="checkbox" checked={gradeEssays} onChange={(event) => setGradeEssays(event.target.checked)} className={checkboxClass} />
          <span className="min-w-0"><span className="block text-sm font-semibold">Grade essays</span><span className="block text-xs text-brand-text/70">Review and grade learner essay responses.</span></span>
        </label>
      </fieldset>
      <div className={accessActions}>
        <button type="button" data-dialog-cancel disabled={isSubmitting} className={accessSecondary} onClick={onCancel}>Cancel</button>
        <button type="button" disabled={isSubmitting || needsRefresh || !changed} className={accessPrimary} onClick={() => onSave({ grade_short_answers: gradeShortAnswers, grade_essays: gradeEssays })}>{isSubmitting ? "Saving..." : "Save permissions"}</button>
      </div>
    </AccessDialog>
  );
}
