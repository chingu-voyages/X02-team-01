import ResetPasswordForm from "@/features/auth/reset/ResetPasswordForm";
import Navbar from "@/components/layouts/Navbar";

export const instant = false;

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <div className="min-h-screen bg-[#f3f4f5]">
      <Navbar />
      <div className="mx-auto max-w-md px-4 py-10">
        <ResetPasswordForm token={token ?? ""} />
      </div>
    </div>
  );
}
