"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";
import {
  usePathname,
  useRouter,
} from "next/navigation";

import { ApiError } from "@/lib/api-client";

type AuthContextValue = {
  token: string | null;
  ready: boolean;
  setToken: (
    token: string | null,
    redirectPath?: string,
  ) => void;
  logout: () => void;
};

const AuthContext =
  createContext<AuthContextValue | undefined>(
    undefined,
  );

const tokenStorageKey = "jhep_auth_token";

const listeners = new Set<() => void>();

function getStoredToken(): string | null {
  try {
    return sessionStorage.getItem(
      tokenStorageKey,
    );
  } catch {
    return null;
  }
}

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

export function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();

  // `undefined` exists only during SSR/hydration.
  // Once the browser snapshot is available, the
  // value becomes either a real token or null.
  const tokenSnapshot = useSyncExternalStore(
    subscribe,
    getStoredToken,
    getServerToken,
  );

  const ready = tokenSnapshot !== undefined;
  const token = tokenSnapshot ?? null;

  const setToken = useCallback(
    (
      newToken: string | null,
      redirectPath = "/categories",
    ) => {
      try {
        if (newToken) {
          sessionStorage.setItem(
            tokenStorageKey,
            newToken,
          );
        } else {
          sessionStorage.removeItem(
            tokenStorageKey,
          );
        }

        notifyTokenChanged();

        if (newToken) {
          router.push(redirectPath);
        }
      } catch (error) {
        console.error(
          "Failed to update sessionStorage",
          error,
        );
      }
    },
    [router],
  );

  const logout = useCallback(() => {
    try {
      sessionStorage.removeItem(
        tokenStorageKey,
      );

      notifyTokenChanged();
    } catch (error) {
      console.error(
        "Failed to clear sessionStorage",
        error,
      );
    }

    router.replace("/login");
  }, [router]);

  return (
    <AuthContext.Provider
      value={{
        token,
        ready,
        setToken,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error(
      "useAuth must be used within an AuthProvider",
    );
  }

  return context;
}

export function useDemoSession() {
  const {
    token,
    ready,
    logout,
  } = useAuth();

  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!ready || token) {
      return;
    }

    const redirect =
      encodeURIComponent(pathname);

    router.replace(
      `/login?redirect=${redirect}`,
    );
  }, [
    ready,
    token,
    pathname,
    router,
  ]);

  const handleError = useCallback(
    (error: unknown) => {
      if (
        error instanceof ApiError &&
        error.status === 401
      ) {
        logout();
        return;
      }

      throw error;
    },
    [logout],
  );

  return {
    token,
    ready,
    handleError,
  };
}