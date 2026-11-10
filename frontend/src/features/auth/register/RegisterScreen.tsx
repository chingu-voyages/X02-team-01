import PageHeader from "@/components/layouts/PageHeader";
import Card from "@/components/ui/Card";
import RegisterForm from "./RegisterForm";
import Navbar from "@/components/layouts/Navbar";

export default function RegisterScreen() {
  return (
    <div>
      <Navbar />
      <PageHeader
        title="Create an account"
        subtitle="Your exam attempts and learning journal will be saved to your profile."
      />

      <div className="mt-6 grid grid-cols-1 md:grid-cols-12">
        <Card className="col-span-7">
          <h2 className="text-xl font-semibold mb-4">Account details</h2>
          <RegisterForm />
        </Card>
        <Card className="col-span-5">
          <h2 className="text-xl font-semibold mb-4">Why create an account</h2>
          <ul>
            <li>Acces previously completed exams</li>
            <li>Keep a timestamped answer journal</li>
            <li>Return for unlimited practice attempts</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
