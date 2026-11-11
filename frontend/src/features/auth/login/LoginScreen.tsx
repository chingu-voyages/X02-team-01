import PageHeader from "@/components/layouts/PageHeader";
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
      <div className="grid grid-cols-2">
        <Card>
          <h2>Practice, learn, repeat.</h2>
          <p>
            Prepare for your next certification with relevant questions, clear
            feedback, and a record of what you have learned.
          </p>
          <ul>
            <li>Practice from approved question sets</li>
            <li>Review your responses and correct answers</li>
            <li>Track past attempts over time</li>
          </ul>
        </Card>
        <Card>
          <LoginForm />
        </Card>
      </div>
    </div>
  );
}
