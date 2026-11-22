import ResetPasswordForm from "@/features/auth/reset/ResetPasswordForm";

export const instant = false;

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <div className="min-h-screen bg-brand-surface">
      <div className="mx-auto max-w-md px-4 py-10">
        <ResetPasswordForm token={token ?? ""} />
      </div>
    </div>
  );
}
