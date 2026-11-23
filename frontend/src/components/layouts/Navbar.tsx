"use client";

import Link from "next/link";
import { useAuth } from "@/features/auth/AuthProvider";
import { Button } from "../ui/button";

const navLink =
  "rounded-xs text-base text-[#303639] transition-colors hover:text-black hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400";

export default function Navbar() {
  const { token, role, logout } = useAuth();
  const staff = role === "contributor" || role === "administrator";
  const administrator = role === "administrator";

  return (
    <nav
      aria-label="Main navigation"
      className="m-4 flex flex-wrap items-center justify-between gap-x-8 gap-y-3 rounded-md border border-[#d4d8db] bg-white px-6 py-5 shadow-xs"
    >
      <div className="flex flex-wrap items-center gap-8">
        <Link
          href={token ? "/categories" : "/login"}
          className="text-base font-bold tracking-tight text-[#303639] hover:underline"
        >
          THE JOB HACKERS
        </Link>

        <div className="flex flex-wrap items-center gap-4 text-sm">
          {token ? (
            <>
              <Link href="/categories" className={navLink}>Practice Exams</Link>
              {staff && (
                <>
                  <span className="select-none text-gray-300" aria-hidden="true">•</span>
                  <Link href="/admin/questions" className={navLink}>Question Bank</Link>
                  <span className="select-none text-gray-300" aria-hidden="true">•</span>
                  <Link href="/account/security" className={navLink}>Account Security</Link>
                </>
              )}
              {administrator && (
                <>
                  <span className="select-none text-gray-300" aria-hidden="true">•</span>
                  <Link href="/admin/practice-exams" className={navLink}>Manage Exams</Link>
                  <span className="select-none text-gray-300" aria-hidden="true">•</span>
                  <Link href="/admin/users" className={navLink}>Users &amp; Access</Link>
                </>
              )}
            </>
          ) : (
            <>
              <Link href="/login" className={navLink}>Sign in</Link>
              <span className="select-none text-gray-300" aria-hidden="true">•</span>
              <Link href="/register" className={navLink}>Create account</Link>
            </>
          )}
        </div>
      </div>
      {token && (
        <Button onClick={logout} variant="outline" className="hover:cursor-pointer">
          Logout
        </Button>
      )}
    </nav>
  );
}
