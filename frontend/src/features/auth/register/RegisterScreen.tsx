import PageHeader from "@/components/layouts/PageHeader";
import Card from "@/components/ui/Card";
import RegisterForm from "./RegisterForm";
import Navbar from "@/components/layouts/Navbar";

export default function RegisterScreen() {
  return (
    <div className="mx-4">
      <Navbar />
      <PageHeader
        title="Create an account"
        subtitle="Your exam attempts and learning journal will be saved to your profile."
      />

      <div className="mt-6 grid grid-cols-1 md:grid-cols-12">
        <Card className="col-span-7 shadow-lg px-6 py-4">
          <h2 className="text-xl font-semibold mb-4">Account details</h2>
          <RegisterForm />
        </Card>
        <Card className="col-span-5 self-start p-10 bg-gray-100">
          <h2 className="font-heading text-xl font-bold text-gray-900 mb-4">
            Why create an account
          </h2>
          <ul className="space-y-3 items-start gap-2.5">
            <li className="flex items-start gap-2.5">
              <svg
                className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M5 13l4 4L19 7"
                />
              </svg>
              <span>Acces previously completed exams</span>
            </li>
            <li className="flex items-start gap-2.5">
              <svg
                className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M5 13l4 4L19 7"
                />
              </svg>
              <span>Keep a timestamped answer journal</span>
            </li>
            <li className="flex items-start gap-2.5">
              <svg
                className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M5 13l4 4L19 7"
                />
              </svg>
              <span>Return for unlimited practice attempts</span>
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
