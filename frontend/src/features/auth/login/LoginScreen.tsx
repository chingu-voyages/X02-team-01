import PageHeader from "@/components/layouts/PageHeader";
import VerifiedNotice from "./VerifiedNotice";
import LoginForm from "./LoginForm";
import Navbar from "@/components/layouts/Navbar";
import Card from "@/components/ui/Card";

export default function LoginScreen() {
  return (
    <div>
      <Navbar />
      <PageHeader
        title="Your practice workspace"
        subtitle="Sign in to access exams and retain your attempt history."
      />
      <VerifiedNotice />
      <div className="grid grid-cols-2 mt-6">
        <Card className="p-6">
          <h2 className="font-bold text-2xl">Practice, learn, repeat.</h2>
          <p className="my-4 text-sm text-gray-500">
            Prepare for your next certification with relevant questions, clear
            feedback, and a record of what you have learned.
          </p>
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
              <span>Practice from approved question sets</span>
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
              <span>Review your responses and correct answers</span>
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
              <span>Track past attempts over time</span>
            </li>
          </ul>
        </Card>
        <Card className="p-6">
          <LoginForm />
        </Card>
      </div>
    </div>
  );
}
