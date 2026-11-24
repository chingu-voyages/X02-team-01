"use client";

import { useState } from "react";

import type { AdminUserItem } from "@/lib/admin-users-api";

type GradingPermissionsDialogProps = {
  user: AdminUserItem;
  isSubmitting: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (permissions: {
    grade_short_answers: boolean;
    grade_essays: boolean;
  }) => void;
};

// JHEP-192: the two independent written-response grading permissions
// (PO wireframe: Users & Access -> Select Contributor -> Written-Response
// Grading Permissions -> enable/disable -> Save). The checkboxes start
// from the account's current values.
export default function GradingPermissionsDialog({
  user,
  isSubmitting,
  error,
  onCancel,
  onSave,
}: GradingPermissionsDialogProps) {
  const [gradeShortAnswers, setGradeShortAnswers] = useState(
    user.grade_short_answers,
  );
  const [gradeEssays, setGradeEssays] = useState(user.grade_essays);

  const checkboxClass =
    "w-4 h-4 cursor-pointer accent-[#3d4145] focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="grading-permissions-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md space-y-4 rounded-md border border-brand-border bg-white p-6 text-brand-text shadow-lg">
        <h2
          id="grading-permissions-title"
          className="text-lg font-bold text-brand-text"
        >
          Written-response grading permissions
        </h2>

        <p className="text-sm leading-6 text-brand-text/75">
          {user.fullName} ({user.email}) — choose which response types
          this Contributor may review and grade. Changes apply
          immediately; previously recorded grades are never affected.
        </p>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </p>
        )}

        <div className="space-y-3">
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-brand-border bg-white p-3 hover:bg-brand-secondary/20">
            <input
              type="checkbox"
              checked={gradeShortAnswers}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                setGradeShortAnswers(event.target.checked)
              }
              className={checkboxClass}
            />
            <span>
              <span className="block text-sm font-semibold">
                Grade short answers
              </span>
              <span className="block text-xs text-brand-text/70">
                Review and grade learner short-answer responses.
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-brand-border bg-white p-3 hover:bg-brand-secondary/20">
            <input
              type="checkbox"
              checked={gradeEssays}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                setGradeEssays(event.target.checked)
              }
              className={checkboxClass}
            />
            <span>
              <span className="block text-sm font-semibold">Grade essays</span>
              <span className="block text-xs text-brand-text/70">
                Review and grade learner essay responses.
              </span>
            </span>
          </label>
        </div>

        <div className="flex justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="cursor-pointer rounded-md border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-text transition-colors hover:bg-brand-secondary/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() =>
              onSave({
                grade_short_answers: gradeShortAnswers,
                grade_essays: gradeEssays,
              })
            }
            disabled={isSubmitting}
            className="cursor-pointer rounded-md bg-[#3d4145] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#292d30] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Saving..." : "Save permissions"}
          </button>
        </div>
      </div>
    </div>
  );
}
