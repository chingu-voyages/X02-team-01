import Link from "next/link";

export default function Navbar() {
  return (
    <nav
      aria-label="Main navigation"
      className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-md border border-[#d4d8db] bg-white px-6 py-5 m-4 shadow-xs"
    >
      <span className="text-base font-bold tracking-tight text-[#303639]">
        THE JOB HACKERS
      </span>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <Link
          href="#"
          className="text-base text-[#303639] hover:text-black hover:underline transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 rounded-xs"
        >
          Exams
        </Link>
        <span className="text-gray-300 select-none" aria-hidden="true">
          •
        </span>
        <Link
          href="#"
          className="text-base text-[#303639] hover:text-black hover:underline transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 rounded-xs"
        >
          My History
        </Link>
        <span className="text-gray-300 select-none" aria-hidden="true">
          •
        </span>
        <Link
          href="#"
          className="text-base text-[#303639] hover:text-black hover:underline transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 rounded-xs"
        >
          My Journal
        </Link>
        <span className="text-gray-300 select-none" aria-hidden="true">
          •
        </span>
        <Link
          href="#"
          className="text-base text-[#303639] hover:text-black hover:underline transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 rounded-xs"
        >
          Account
        </Link>
      </div>
    </nav>
  );
}
