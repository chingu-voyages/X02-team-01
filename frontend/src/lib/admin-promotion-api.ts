import { apiRequest } from "@/lib/api-client";
import type { AdminUserItem } from "@/lib/admin-users-api";

export type AdministratorPromotionEligibility = {
  target: AdminUserItem;
  mfa_enrolled: boolean;
  eligible: boolean;
  issues: { code: string; message: string }[];
  recent_authentication: boolean;
  authentication_max_age_seconds: number;
};

export type AdministratorPromotionConfirmation = {
  confirmation_email: string;
  confirm: true;
  reason: string;
};

export type AdministratorPromotionResult = {
  user: AdminUserItem;
  audit_id: string;
  action: "promoted";
  role_before: "contributor";
  role_after: "administrator";
  changed_at: string;
  previous_privileged_sessions_revoked: true;
};

function endpoint(userId: string) {
  return `/admin/users/${encodeURIComponent(userId)}/administrator-promotion`;
}

export function getAdministratorPromotionEligibility(token: string, userId: string) {
  return apiRequest<AdministratorPromotionEligibility>(endpoint(userId), token, { method: "GET" });
}

export function promoteAdministrator(token: string, userId: string, confirmation: AdministratorPromotionConfirmation) {
  return apiRequest<AdministratorPromotionResult>(endpoint(userId), token, {
    method: "POST",
    body: JSON.stringify(confirmation),
  });
}
