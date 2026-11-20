import { Suspense } from "react";

function AdminLoadingFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <p role="status" className="text-sm text-brand-text/70">
        Loading admin console...
      </p>
    </div>
  );
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Suspense fallback={<AdminLoadingFallback />}>{children}</Suspense>;
}
