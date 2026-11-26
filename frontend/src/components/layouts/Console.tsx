"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardCheck,
  ClipboardList,
  FileQuestion,
  FileText,
  History,
  LayoutGrid,
  LineChart,
  LogOut,
  ShieldCheck,
  Menu,
  MessageSquarePlus,
  Search,
  Shapes,
  TrendingUp,
  UserCircle,
  UserCog,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAuth, type UserRole } from "@/features/auth/AuthProvider";

type NavItem = {
  label: string;
  href?: string;
  icon: LucideIcon;
  roles: UserRole[];
  disabled?: boolean;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

const navSections: NavSection[] = [
  {
    title: "OVERVIEW",
    items: [
      {
        label: "Dashboard",
        icon: LayoutGrid,
        roles: ["contributor", "administrator"],
        disabled: true,
      },
    ],
  },
  {
    title: "CONTENT MANAGEMENT",
    items: [
      {
        label: "Question Bank",
        href: "/admin/questions",
        icon: FileText,
        roles: ["contributor", "administrator"],
      },
      {
        label: "Question Reviews",
        icon: MessageSquarePlus,
        roles: ["contributor", "administrator"],
        disabled: true,
      },
      {
        label: "Certifications & Categories",
        href: "/admin/catalog",
        icon: Shapes,
        roles: ["administrator"],
      },
      {
        label: "Manage Exams",
        href: "/admin/practice-exams",
        icon: ClipboardList,
        roles: ["administrator"],
      },
      {
        label: "Practice Exams",
        href: "/categories",
        icon: FileQuestion,
        roles: ["learner", "contributor", "administrator"],
      },
    ],
  },
  {
    title: "GRADING",
    items: [
      {
        label: "Manual Grading",
        href: "/admin/manual-grading",
        icon: ClipboardCheck,
        roles: ["contributor", "administrator"],
      },
    ],
  },
  {
    title: "USER MANAGEMENT",
    items: [
      {
        label: "Users & Access",
        href: "/admin/users",
        icon: UserCog,
        roles: ["administrator"],
      },
    ],
  },
  {
    title: "REPORTING",
    items: [
      {
        label: "Exam Performance",
        icon: TrendingUp,
        roles: ["contributor", "administrator"],
        disabled: true,
      },
      {
        label: "Question Performance",
        icon: LineChart,
        roles: ["contributor", "administrator"],
        disabled: true,
      },
      {
        label: "Audit Log",
        icon: History,
        roles: ["contributor", "administrator"],
        disabled: true,
      },
    ],
  },
];

const publicPaths = ["/login", "/register", "/forgot-password", "/reset-password"];

// Use a consistent snapshot during server rendering and initial hydration.
// The authenticated shell is rendered only after the browser session is ready.
const subscribeToHydration = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export default function Console({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { token, role, ready, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    getClientSnapshot,
    getServerSnapshot,
  );

  const isPublicRoute = publicPaths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );

  // Keep the route segment mounted during prerendering and hydration.
  // Gate only the console chrome, not the page itself. Protected pages
  // and the backend retain their existing authentication checks.
  const showConsole = hydrated && ready && Boolean(token) && !isPublicRoute;

  const consoleLabel =
    role === "administrator"
      ? "ADMIN CONSOLE"
      : role === "contributor"
        ? "CONTRIBUTOR CONSOLE"
        : "LEARNER CONSOLE";

  const visibleSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => role !== null && item.roles.includes(role),
      ),
    }))
    .filter((section) => section.items.length > 0);

  const sidebarContent = (
    <div className="flex h-full flex-col bg-brand-primary-dark text-white">
      {/* Brand Header */}
      <div className="px-5 pb-6 pt-6">
        <Link
          href="/categories"
          onClick={() => setMobileOpen(false)}
          className="flex items-center gap-2.5 hover:opacity-90"
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white text-brand-primary-dark">
            <Search className="size-4 stroke-[2.5]" aria-hidden="true" />
          </div>
          <div>
            <p className="text-base font-bold leading-none tracking-tight">
              The Job Hackers
            </p>
            <p className="mt-1 text-[9px] font-semibold tracking-[0.14em] text-white/80">
              PRACTICE EXAM ENGINE
            </p>
          </div>
        </Link>

        <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/75">
          {consoleLabel}
        </p>
      </div>

      {/* Role-Filtered Navigation Sections */}
      <nav
        aria-label="Main navigation"
        className="flex-1 space-y-6 overflow-y-auto px-3 pb-6"
      >
        {visibleSections.map((section) => (
          <div key={section.title}>
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55">
              {section.title}
            </p>
            <div className="space-y-1">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive =
                  !item.disabled &&
                  Boolean(item.href) &&
                  (pathname === item.href ||
                    pathname.startsWith(`${item.href}/`));

                if (item.disabled || !item.href) {
                  return (
                    <div
                      key={item.label}
                      aria-disabled="true"
                      title="Coming soon"
                      className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/45 select-none"
                    >
                      <Icon className="size-4 shrink-0" aria-hidden="true" />
                      <span>{item.label}</span>
                    </div>
                  );
                }

                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                      isActive
                        ? "bg-brand-accent font-semibold text-brand-text shadow-xs"
                        : "font-medium text-white/90 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom Account Section */}
      <div className="mt-auto border-t border-white/10 px-3 py-4">
        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55">
          ACCOUNT
        </p>
        <div className="space-y-1">
          {(role === "administrator" || role === "contributor") && (
            <Link
              href="/account/security"
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                pathname.startsWith("/account/security")
                  ? "bg-brand-accent text-brand-text"
                  : "text-white/90 hover:bg-white/10 hover:text-white"
              }`}
            >
              <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
              <span>Account Security</span>
            </Link>
          )}
          <div
            aria-disabled="true"
            title="Coming soon"
            className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/45 select-none"
          >
            <UserCircle className="size-4 shrink-0" aria-hidden="true" />
            <span>My Account</span>
          </div>

          <button
            type="button"
            onClick={() => {
              setMobileOpen(false);
              logout();
            }}
            className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-white/90 transition-colors hover:bg-white/10 hover:text-white"
          >
            <LogOut className="size-4 shrink-0" aria-hidden="true" />
            <span>Log Out</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className={showConsole ? "min-h-screen bg-brand-surface text-brand-text" : "contents"}>
      {/* Mobile Top Header */}
      {showConsole && (
        <header className="sticky top-0 z-30 flex items-center justify-between bg-brand-primary-dark px-4 py-3 text-white lg:hidden">
          <Link href="/categories" className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-full bg-white text-brand-primary-dark">
              <Search className="size-3.5 stroke-[2.5]" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-bold leading-none">The Job Hackers</p>
              <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/75">
                {consoleLabel}
              </p>
            </div>
          </Link>

          <button
            type="button"
            onClick={() => setMobileOpen((prev) => !prev)}
            aria-expanded={mobileOpen}
            aria-label={
              mobileOpen ? "Close navigation menu" : "Open navigation menu"
            }
            className="rounded-md p-2 text-white hover:bg-white/10"
          >
            {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </header>
      )}

      {/* Mobile Slide-Over Drawer */}
      {showConsole && mobileOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-50 w-64 max-w-[80vw]">
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Stable page wrappers prevent the active page from remounting when
          the session is restored. Public routes keep their original layout. */}
      <div
        className={
          showConsole
            ? "lg:grid lg:min-h-screen lg:grid-cols-[240px_minmax(0,1fr)]"
            : "contents"
        }
      >
        {showConsole && (
          <aside className="hidden lg:sticky lg:top-0 lg:block lg:h-screen">
            {sidebarContent}
          </aside>
        )}

        <div
          role={showConsole ? "main" : undefined}
          className={showConsole ? "min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-7" : "contents"}
        >
          <div className={showConsole ? "mx-auto w-full max-w-280" : "contents"}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
