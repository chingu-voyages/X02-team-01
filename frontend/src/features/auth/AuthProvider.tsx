"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { ApiError } from "@/lib/api-client";

type AuthContextValue = {
  token: string | null;
  ready: boolean;
  setToken: (token: string | null, redirectPath?: string) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const tokenStorageKey = "jhep_demo_token";

// Event listeners to notify React when sessionStorage updates in this tab
const listeners = new Set<() => void>();

function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(tokenStorageKey);
  } catch {
    return null;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  }
}
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  // useSyncExternalStore safely reads sessionStorage for SSR and client hydration
  const token = useSyncExternalStore(
    subscribe,
    getStoredToken,
    () => null // Server snapshot defaults to null
  );

  const ready = true; // Always ready since useSyncExternalStore resolves synchronously on mount

  const setToken = useCallback((newToken: string | null, redirectPath = "/categories") => {
    try {
      if (newToken) {
        sessionStorage.setItem(tokenStorageKey, newToken);
      } else {
        sessionStorage.removeItem(tokenStorageKey);
      }
      // Notify listeners to trigger re-render
      listeners.forEach((listener) => listener());

      if (newToken) {
        router.push(redirectPath);
      }
    } catch (e) {
      console.error("Failed to update sessionStorage", e);
    }
  }, [router]);

  const logout = useCallback(() => {
    try {
      sessionStorage.removeItem(tokenStorageKey);
      listeners.forEach((listener) => listener());
    } catch (e) {
      console.error("Failed to clear sessionStorage", e);
    }
    router.replace("/access");
  }, [router]);

  return (
    <AuthContext.Provider value={{ token, ready, setToken, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

export function useDemoSession() {
  const { token, ready, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (ready && !token && pathname !== "/access") {
      router.replace("/access");
    }
  }, [ready, token, pathname, router]);

  const handleError = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      logout();
    } else {
      throw error;
    }
  }, [logout]);

  return { token, ready, handleError };
}