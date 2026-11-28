"use client";

import type { AdminUserItem, ManageableUserRole } from "@/lib/admin-users-api";
import AccessDialog, { AccessError, accessActions, accessPrimary, accessSecondary } from "./AccessDialog";

type RoleChangeDialogProps = {
  user: AdminUserItem;
  targetRole: ManageableUserRole;
  isSubmitting: boolean;
  error: string | null;
  needsRefresh?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function RoleChangeDialog({ user, targetRole, isSubmitting, error, needsRefresh, onCancel, onConfirm }: RoleChangeDialogProps) {
  const isGranting = targetRole === "contributor";
  return (
    <AccessDialog title={isGranting ? "Grant Contributor access?" : "Revoke Contributor access?"} busy={isSubmitting} onCancel={onCancel}>
      <p className="text-sm leading-6 text-brand-text/75">
        {isGranting ? `${user.fullName} (${user.email}) will gain draft-authoring access.` : `${user.fullName} (${user.email}) will lose Contributor access immediately, including in any open session. Their account, history and authored questions stay intact.`}
      </p>
      {error && <AccessError message={error} />}
      <div className={accessActions}>
        <button type="button" data-dialog-cancel disabled={isSubmitting} className={accessSecondary} onClick={onCancel}>Cancel</button>
        <button type="button" disabled={isSubmitting || needsRefresh} className={accessPrimary} onClick={onConfirm}>{isSubmitting ? "Applying..." : isGranting ? "Confirm: make Contributor" : "Confirm: revoke Contributor"}</button>
      </div>
    </AccessDialog>
  );
}
