"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { ApiError } from "@/lib/api-client";

export type UserRole = "learner" | "contributor" | "administrator";

type AuthActions = {
  setToken: (token: string | null, redirectPath?: string) => void;
  logout: () => void;
};

type AuthContextValue = AuthActions & {
  token: string | null;
  role: UserRole | null;
  ready: boolean;
};

// Share session actions through context, not the live browser snapshot.
// A root provider can hydrate before a streamed child route does.
const AuthContext = createContext<AuthActions | undefined>(undefined);
const tokenStorageKey = "jhep_auth_token";
const listeners = new Set<() => void>();

function getStoredToken(): string | null {
  try {
    return sessionStorage.getItem(tokenStorageKey);
  } catch {
    return null;
  }
}

// Undefined means the session has not been read yet. Null means that
// the browser session was checked and no token exists.
function getServerToken(): undefined {
  return undefined;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyTokenChanged() {
  listeners.forEach((listener) => {
    listener();
  });
}

function roleFromToken(token: string | null): UserRole | null {
  if (!token) return null;

  try {
    const parts = token.split(".");
    if (parts.length < 2 || !parts[1]) return null;

    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      Math.ceil(normalized.length / 4) * 4,
      "=",
    );
    const payload = JSON.parse(atob(padded)) as { role?: unknown };

    if (
      payload.role === "learner" ||
      payload.role === "contributor" ||
      payload.role === "administrator"
    ) {
      return payload.role;
    }
    return null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const setToken = useCallback(
    (newToken: string | null, redirectPath = "/categories") => {
      try {
        if (newToken) {
          sessionStorage.setItem(tokenStorageKey, newToken);
        } else {
          sessionStorage.removeItem(tokenStorageKey);
        }
        notifyTokenChanged();
        if (newToken) router.push(redirectPath);
      } catch (error) {
        console.error("Failed to update sessionStorage", error);
      }
    },
    [router],
  );

  const logout = useCallback(() => {
    const stored = getStoredToken();

    try {
      sessionStorage.removeItem(tokenStorageKey);
      notifyTokenChanged();
    } catch (error) {
      console.error("Failed to clear sessionStorage", error);
    }

    if (stored) {
      void fetch("/api/v1/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${stored}` },
      }).catch(() => undefined);
    }
    router.replace("/login");
  }, [router]);

  const actions = useMemo(() => ({ setToken, logout }), [setToken, logout]);

  return (
    <AuthContext.Provider value={actions}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const actions = useContext(AuthContext);

  // Each consumer must use its own server snapshot during hydration.
  // Reading only the provider's already-restored token can cause a late
  // hydrating route to render authenticated markup against guest HTML.
  const tokenSnapshot = useSyncExternalStore(
    subscribe,
    getStoredToken,
    getServerToken,
  );

  if (!actions) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  const token = tokenSnapshot ?? null;

  return {
    token,
    role: roleFromToken(token),
    ready: tokenSnapshot !== undefined,
    setToken: actions.setToken,
    logout: actions.logout,
  };
}

export function useDemoSession() {
  const { token, role, ready, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!ready || token) return;
    const redirect = encodeURIComponent(pathname);
    router.replace(`/login?redirect=${redirect}`);
  }, [ready, token, pathname, router]);

  const handleError = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        logout();
        return;
      }
      throw error;
    },
    [logout],
  );

  return { token, role, ready, handleError };
}
