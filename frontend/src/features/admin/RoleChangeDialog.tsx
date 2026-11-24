"use client";

import type {
  AdminUserItem,
  ManageableUserRole,
} from "@/lib/admin-users-api";

type RoleChangeDialogProps = {
  user: AdminUserItem;
  targetRole: ManageableUserRole;
  isSubmitting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function RoleChangeDialog({
  user,
  targetRole,
  isSubmitting,
  error,
  onCancel,
  onConfirm,
}: RoleChangeDialogProps) {
  const isGranting = targetRole === "contributor";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="role-change-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md space-y-4 rounded-md border border-brand-border bg-white p-6 text-brand-text shadow-lg">
        <h2 id="role-change-title" className="text-lg font-bold text-brand-text">
          {isGranting ? "Grant Contributor access?" : "Revoke Contributor access?"}
        </h2>

        <p className="text-sm leading-6 text-brand-text/75">
          {isGranting
            ? `${user.fullName} (${user.email}) will gain draft-authoring access.`
            : `${user.fullName} (${user.email}) will lose Contributor access immediately, including in any open session. Their account, history and authored questions stay intact.`}
        </p>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </p>
        )}

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
            onClick={onConfirm}
            disabled={isSubmitting}
            className="cursor-pointer rounded-md bg-brand-accent px-4 py-2 text-sm font-semibold text-brand-text transition-colors hover:bg-brand-accent-tint disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting
              ? "Applying..."
              : isGranting
                ? "Confirm: make Contributor"
                : "Confirm: revoke Contributor"}
          </button>
        </div>
      </div>
    </div>
  );
}