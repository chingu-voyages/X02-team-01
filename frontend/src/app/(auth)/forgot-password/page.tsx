import ForgotPasswordForm from "@/features/auth/reset/ForgotPasswordForm";

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen bg-[#f3f4f5]">
      <div className="mx-auto max-w-md px-4 py-10">
        <ForgotPasswordForm />
      </div>
    </div>
  );
}
