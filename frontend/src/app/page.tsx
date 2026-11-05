import Link from "next/link";

export default function Home() {
  return (
    <main className="p-4 sm:p-6 space-y-4">
      <h1 className="text-lg sm:text-2xl font-semibold">
        Job Hackers Exam Prep
      </h1>
      <p className="text-sm text-gray-700">
        Choose a practice exam category to get started.
      </p>
      <Link
        href="/categories"
        className="inline-block rounded-sm border border-[#d4d8db] bg-white px-4 py-2 text-sm font-medium hover:bg-gray-100"
      >
        Browse practice categories
      </Link>
    </main>
  );
}
