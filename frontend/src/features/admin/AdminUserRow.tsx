"use client";

import type {
  AdminUserItem,
  ManageableUserRole,
} from "@/lib/admin-users-api";

type AdminUserRowProps = {
  user: AdminUserItem;
  onRequestRoleChange: (user: AdminUserItem, targetRole: ManageableUserRole) => void;
  onRequestGradingPermissions: (user: AdminUserItem) => void;
};

function roleBadgeClasses(role: AdminUserItem["role"]): string {
  switch (role) {
    case "administrator":
      return "bg-brand-secondary/50 text-brand-text";
    case "contributor":
      return "bg-brand-accent-tint text-brand-text";
    default:
      return "border border-brand-border bg-brand-surface text-brand-text/80";
  }
}

export default function AdminUserRow({
  user,
  onRequestRoleChange,
  onRequestGradingPermissions,
}: AdminUserRowProps) {
  const isManageable = user.role !== "administrator";
  const targetRole: ManageableUserRole =
    user.role === "contributor" ? "learner" : "contributor";

  return (
    <li className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-brand-border bg-white p-4 text-brand-text shadow-xs">
      <div className="space-y-1">
        <p className="font-semibold text-brand-text">{user.fullName}</p>
        <p className="text-sm text-brand-text/70">{user.email}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {user.role === "contributor" && (
          <span
            className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${
              user.grade_short_answers || user.grade_essays
                ? "bg-emerald-100 text-emerald-800"
                : "bg-brand-secondary/40 text-brand-text/70"
            }`}
          >
            {user.grade_short_answers && user.grade_essays
              ? "Grades: short + essays"
              : user.grade_short_answers
                ? "Grades: short answers"
                : user.grade_essays
                  ? "Grades: essays"
                  : "No grading permissions"}
          </span>
        )}
        <span
          className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${roleBadgeClasses(user.role)}`}
        >
          {user.role}
        </span>

        <span className="text-xs font-medium text-brand-text/65">
          {user.is_verified ? "verified" : "unverified"}
        </span>

        {user.role === "contributor" && (
          <button
            type="button"
            onClick={() => onRequestGradingPermissions(user)}
            className="cursor-pointer rounded-md border border-brand-border bg-white px-3.5 py-1.5 text-sm font-semibold text-brand-text transition-colors hover:bg-brand-secondary/30"
          >
            Grading Permissions
          </button>
        )}
        {isManageable ? (
          <button
            type="button"
            onClick={() => onRequestRoleChange(user, targetRole)}
            className="cursor-pointer rounded-md border border-brand-border bg-white px-3.5 py-1.5 text-sm font-semibold text-brand-text transition-colors hover:bg-brand-secondary/30"
          >
            {user.role === "contributor"
              ? "Revoke Contributor"
              : "Make Contributor"}
          </button>
        ) : (
          <span
            className="text-xs font-medium text-brand-text/60"
            title="Administrator provisioning is separately governed"
          >
            Administrator
          </span>
        )}
      </div>
    </li>
  );
}