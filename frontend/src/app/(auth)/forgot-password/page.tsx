import ForgotPasswordForm from "@/features/auth/reset/ForgotPasswordForm";
import Navbar from "@/components/layouts/Navbar";

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen bg-[#f3f4f5]">
      <Navbar />
      <div className="mx-auto max-w-md px-4 py-10">
        <ForgotPasswordForm />
      </div>
    </div>
  );
}
