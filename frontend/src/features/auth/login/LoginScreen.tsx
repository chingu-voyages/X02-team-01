import PageHeader from "@/components/layouts/PageHeader";
import VerifiedNotice from "./VerifiedNotice";
import LoginForm from "./LoginForm";
import Card from "@/components/ui/Card";

const highlights = [
  "Practice from approved question sets",
  "Review your responses and correct answers",
  "Track past attempts over time",
];

export default function LoginScreen() {
  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Your practice workspace"
        subtitle="Sign in to access exams and retain your attempt history."
      />

      <VerifiedNotice />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card className="flex flex-col justify-between border-brand-border bg-brand-surface/40 p-6 text-brand-text shadow-xs sm:p-8">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-brand-text">
              Practice, learn, repeat.
            </h2>
            <p className="mt-3 text-sm leading-6 text-brand-text/70">
              Prepare for your next certification with relevant questions, clear
              feedback, and a record of what you have learned.
            </p>

            <ul className="mt-6 space-y-3.5 text-sm text-brand-text/85">
              {highlights.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-accent-tint text-brand-text">
                    <svg
                      className="size-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2.5"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <Card className="border-brand-border bg-brand-surface p-6 text-brand-text shadow-xs sm:p-8">
          <LoginForm />
        </Card>
      </div>
    </section>
  );
}
