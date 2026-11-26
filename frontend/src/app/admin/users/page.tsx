"use client";

// JHEP-125/JHEP-192: thin route composition of the shared Users & Access
// page component. The full implementation (including the JHEP-192
// grading-permissions dialog) lives in features/admin/AdminUsersPage —
// duplicating it here caused the permissions dialog to silently vanish
// from the rendered page.
import AdminUsersPage from "@/features/admin/AdminUsersPage";

export default function Page() {
  return <AdminUsersPage />;
}
