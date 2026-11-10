import { Suspense } from "react";

import AdminShell from "@/components/layouts/AdminShell";

function AdminLoadingFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white">
      <p
        role="status"
        className="text-sm text-[#687178]"
      >
        Loading admin console...
      </p>
    </main>
  );
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<AdminLoadingFallback />}>
      <AdminShell>{children}</AdminShell>
    </Suspense>
  );
}