import { apiRequest } from "@/lib/api-client";

export interface AdminUserItem {
  id: string;
  email: string;
  fullName: string;
  role: "learner" | "contributor" | "administrator";
  is_verified: boolean;
  created_at: string;
}

export interface AdminUsersPage {
  items: AdminUserItem[];
  total: number;
  limit: number;
  offset: number;
}

export type ManageableUserRole = "learner" | "contributor";

export interface AdminUserRoleChange {
  user: AdminUserItem;
  action: "promoted" | "revoked";
  role_before: string;
  role_after: string;
  changed_at: string;
}

export async function getAdminUsers(
  token: string,
  query?: string,
): Promise<AdminUsersPage> {
  const search = query?.trim()
    ? `?q=${encodeURIComponent(query.trim())}`
    : "";

  return apiRequest<AdminUsersPage>(
    `/admin/users${search}`,
    token,
    {
      method: "GET",
    },
  );
}

export async function changeAdminUserRole(
  token: string,
  userId: string,
  role: ManageableUserRole,
): Promise<AdminUserRoleChange> {
  return apiRequest<AdminUserRoleChange>(
    `/admin/users/${encodeURIComponent(userId)}/role`,
    token,
    {
      method: "PATCH",
      body: JSON.stringify({ role }),
    },
  );
}
