"use client";

import type { AdminUserItem, ManageableUserRole } from "@/lib/admin-users-api";

type AdminUserRowProps = {
  user: AdminUserItem;
  onRequestRoleChange: (user: AdminUserItem, targetRole: ManageableUserRole) => void;
  onRequestGradingPermissions: (user: AdminUserItem) => void;
  onRequestPromotion?: (user: AdminUserItem) => void;
};

const action = "inline-flex min-h-11 w-full min-w-0 items-center justify-center rounded-md border border-brand-border bg-white px-3 py-2 text-center text-sm font-semibold text-brand-text hover:bg-brand-surface focus-visible:outline-2 focus-visible:outline-offset-2 sm:w-auto";

function roleBadgeClasses(role: AdminUserItem["role"]) {
  if (role === "administrator") return "bg-brand-secondary/50 text-brand-text";
  if (role === "contributor") return "bg-brand-accent-tint text-brand-text";
  return "border border-brand-border bg-brand-surface text-brand-text/80";
}

export default function AdminUserRow({ user, onRequestRoleChange, onRequestGradingPermissions, onRequestPromotion }: AdminUserRowProps) {
  return (
    <li className="min-w-0 space-y-3 rounded-lg border border-brand-border bg-white p-4 text-brand-text shadow-xs [overflow-wrap:anywhere]">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="font-semibold">{user.fullName || "Unnamed account"}</p>
          <p className="text-sm text-brand-text/70">{user.email}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${roleBadgeClasses(user.role)}`}>{user.role}</span>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${user.is_verified ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>{user.is_verified ? "verified" : "unverified"}</span>
        </div>
      </div>
      {user.role === "contributor" && (
        <p className="text-sm text-brand-text/75">
          {user.grade_short_answers && user.grade_essays ? "Grades: short + essays" : user.grade_short_answers ? "Grades: short answers" : user.grade_essays ? "Grades: essays" : "No grading permissions"}
        </p>
      )}
      {user.role === "administrator" ? (
        <p className="border-t border-brand-border pt-3 text-xs text-brand-text/70"><span className="font-semibold">Administrator</span> · Protected role. Administrator roles cannot be revoked here.</p>
      ) : (
        <div className="flex min-w-0 flex-col gap-2 border-t border-brand-border pt-3 sm:flex-row sm:flex-wrap" role="group" aria-label={`Access actions for ${user.email}`}>
          {user.role === "contributor" && (
            <>
              <button type="button" className={action} onClick={() => onRequestGradingPermissions(user)}>Grading Permissions</button>
              {onRequestPromotion && <button type="button" className={`${action} border-amber-300 text-amber-900 hover:bg-amber-50`} onClick={() => onRequestPromotion(user)}>Grant Administrator access</button>}
            </>
          )}
          <button type="button" className={action} onClick={() => onRequestRoleChange(user, user.role === "contributor" ? "learner" : "contributor")}>{user.role === "contributor" ? "Revoke Contributor" : "Make Contributor"}</button>
        </div>
      )}
    </li>
  );
}
