"use client";

import Link from "next/link";

import {
  usePathname,
} from "next/navigation";

import {
  BookOpenCheck,
  ChevronDown,
  FileText,
  Gauge,
  Library,
  Settings,
  Users,
} from "lucide-react";

import {
  useAuth,
} from "@/features/auth/AuthProvider";

const navItems = [
  {
    label:
      "Dashboard",
    href:
      "/admin",
    icon:
      Gauge,
    enabled:
      false,
  },
  {
    label:
      "Question Bank",
    href:
      "/admin/questions",
    icon:
      FileText,
    enabled:
      true,
  },
  {
    label:
      "Catalog",
    href:
      "/admin/catalog",
    icon:
      Library,
    enabled:
      true,
  },
  {
    label:
      "Practice Exams",
    href:
      "/categories",
    icon:
      BookOpenCheck,
    enabled:
      true,
  },
  {
    label:
      "Users & Access",
    href:
      "/admin/users",
    icon:
      Users,
    enabled:
      false,
  },
  {
    label:
      "Reports",
    href:
      "/admin/reports",
    icon:
      FileText,
    enabled:
      false,
  },
  {
    label:
      "Settings",
    href:
      "/admin/settings",
    icon:
      Settings,
    enabled:
      false,
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
    logout,
  } =
    useAuth();

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
          Admin Console
        </Link>
      </header>

      <div className="lg:grid lg:min-h-screen lg:grid-cols-[200px_minmax(0,1fr)]">
        <aside className="hidden min-h-screen flex-col border-r border-[#dedfe1] bg-[#f2f2f2] lg:flex">
          <div className="px-4 pb-10 pt-5">
            <p className="text-[15px] font-extrabold leading-tight">
              THE JOB HACKERS
            </p>

            <p className="mt-1 text-sm font-semibold">
              PRACTICE ENGINE
            </p>

            <p className="mt-1 text-[10px] uppercase tracking-wide text-[#74797d]">
              Admin Console /
              MVP
            </p>
          </div>

          <nav
            aria-label="Admin navigation"
            className="space-y-1 px-2"
          >
            {navItems.map(
              (item) => {
                const Icon =
                  item.icon;

                const active =
                  item.enabled &&
                  pathname.startsWith(
                    item.href,
                  );

                const classes =
                  `flex w-full items-center gap-2 rounded-md px-3 py-3 text-sm ${
                    active
                      ? "bg-[#dddfe2] font-semibold text-[#292d30]"
                      : item.enabled
                        ? "text-[#33383c] hover:bg-[#e6e7e9]"
                        : "cursor-not-allowed text-[#555b60]"
                  }`;

                if (
                  !item.enabled
                ) {
                  return (
                    <span
                      key={
                        item.label
                      }
                      className={
                        classes
                      }
                      aria-disabled="true"
                    >
                      <Icon
                        aria-hidden="true"
                        className="size-3.5"
                      />

                      {
                        item.label
                      }
                    </span>
                  );
                }

                return (
                  <Link
                    key={
                      item.label
                    }
                    href={
                      item.href
                    }
                    className={
                      classes
                    }
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

          <div className="mt-auto p-3">
            <button
              type="button"
              onClick={
                logout
              }
              className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-[#e6e7e9]"
            >
              <span>
                Admin User
              </span>

              <ChevronDown
                aria-hidden="true"
                className="size-3.5"
              />
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