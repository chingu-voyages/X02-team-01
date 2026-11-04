export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(
  path: string,
  token: string | null,
  init: RequestInit = {},
): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_URL;

  if (!base) {
    throw new Error("NEXT_PUBLIC_API_URL is not configured");
  }

  if (!token) {
    throw new ApiError(401, "Access token is required");
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body) {
    headers.set("Content-Type", "application/json");
  }

  const cleanBase = base.replace(/\/$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;

  const res = await fetch(`${cleanBase}${cleanPath}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  if (!res.ok) {
    throw new ApiError(
      res.status,
      res.status === 401
        ? "Your session has expired. Please enter a new token."
        : `API request failed (${res.status})`,
    );
  }

  return (await res.json()) as T;
}
