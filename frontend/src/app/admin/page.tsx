"use client";

// JHEP-115: thin route composition of the shared dashboard overview
// component (the app/users lesson — never duplicate page logic here).
import AdminOverviewPage from "@/features/admin/AdminOverviewPage";

export default function Page() {
  return <AdminOverviewPage />;
}
