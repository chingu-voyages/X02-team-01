"use client";

import Link from "next/link";

import {
  usePathname,
} from "next/navigation";

import {
  BookOpenCheck,
  FileText,
  Library,
  LogOut,
  Users,
} from "lucide-react";

import {
  useAuth,
  type UserRole,
} from "@/features/auth/AuthProvider";


type NavItem = {
  label: string;
  href: string;
  icon:
    typeof FileText;
  roles: UserRole[];
};


const navItems:
  NavItem[] = [
    {
      label:
        "Question Bank",

      href:
        "/admin/questions",

      icon:
        FileText,

      roles: [
        "contributor",
        "administrator",
      ],
    },

    {
      label:
        "Catalog",

      href:
        "/admin/catalog",

      icon:
        Library,

      roles: [
        "administrator",
      ],
    },

    {
      label:
        "Practice Exams",

      href:
        "/categories",

      icon:
        BookOpenCheck,

      roles: [
        "learner",
        "contributor",
        "administrator",
      ],
    },

    {
      label:
        "Users & Access",

      href:
        "/admin/users",

      icon:
        Users,

      roles: [
        "administrator",
      ],
    },
  ];


export default function AdminShell({
  children,
}: {
  children:
    React.ReactNode;
}) {
  const pathname =
    usePathname();

  const {
    role,
    logout,
  } =
    useAuth();


  const visibleItems =
    navItems.filter(
      (item) =>
        role !== null &&
        item.roles.includes(
          role,
        ),
    );


  const roleLabel =
    role ===
    "administrator"
      ? "Administrator"
      : role ===
          "contributor"
        ? "Contributor"
        : "User";


  return (
    <div className="min-h-screen bg-white text-[#292d30]">
      <header className="flex items-center justify-between border-b border-[#dedfe1] bg-[#f2f2f2] px-4 py-3 lg:hidden">
        <div>
          <p className="text-sm font-extrabold leading-tight">
            THE JOB HACKERS
          </p>

          <p className="text-xs font-semibold">
            PRACTICE ENGINE
          </p>
        </div>

        <Link
          href="/admin/questions"
          className="rounded-md bg-[#dedfe2] px-3 py-2 text-sm font-semibold"
        >
          Question Bank
        </Link>
      </header>


      <div className="lg:grid lg:min-h-screen lg:grid-cols-[200px_minmax(0,1fr)]">
        <aside className="hidden min-h-screen flex-col border-r border-[#dedfe1] bg-[#f2f2f2] lg:flex">
          <div className="px-4 pb-10 pt-5">
            <Link
              href="/categories"
              className="block hover:underline"
            >
              <p className="text-[15px] font-extrabold leading-tight">
                THE JOB HACKERS
              </p>

              <p className="mt-1 text-sm font-semibold">
                PRACTICE ENGINE
              </p>
            </Link>

            <p className="mt-1 text-[10px] uppercase tracking-wide text-[#74797d]">
              {roleLabel} Console /
              MVP
            </p>
          </div>


          <nav
            aria-label="Management navigation"
            className="space-y-1 px-2"
          >
            {visibleItems.map(
              (item) => {
                const Icon =
                  item.icon;

                const active =
                  pathname.startsWith(
                    item.href,
                  );

                return (
                  <Link
                    key={
                      item.label
                    }
                    href={
                      item.href
                    }
                    className={`flex w-full items-center gap-2 rounded-md px-3 py-3 text-sm ${
                      active
                        ? "bg-[#dddfe2] font-semibold text-[#292d30]"
                        : "text-[#33383c] hover:bg-[#e6e7e9]"
                    }`}
                  >
                    <Icon
                      aria-hidden="true"
                      className="size-3.5"
                    />

                    {
                      item.label
                    }
                  </Link>
                );
              },
            )}
          </nav>


          <div className="mt-auto border-t border-[#dedfe1] p-3">
            <p className="px-2 pb-2 text-xs font-semibold text-[#686e72]">
              {roleLabel}
            </p>

            <button
              type="button"
              onClick={
                logout
              }
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-[#e6e7e9]"
            >
              <LogOut
                aria-hidden="true"
                className="size-3.5"
              />

              Sign out
            </button>
          </div>
        </aside>


        <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
          <div className="mx-auto w-full max-w-[1120px]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}