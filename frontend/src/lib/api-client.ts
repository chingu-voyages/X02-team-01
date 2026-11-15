export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly detail: unknown = null,
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
  // Default to the same-origin proxy (`/api/v1/*` -> the backend via
  // BACKEND_PROXY_TARGET, read at request time by the catch-all route
  // handler). NEXT_PUBLIC_API_URL stays as an optional absolute override
  // — but it is a BUILD-TIME variable in Next, so deployments that bake
  // no value (e.g. Render's docker runtime) must keep working: the
  // relative base always does. (JHEP-125: the admin screens died on
  // Render with "NEXT_PUBLIC_API_URL is not configured" because a
  // localhost dev value was baked instead.)
    // An env var present but EMPTY also means "not configured" (the
  // project-wide convention, cf. the email settings validators).
  const base = process.env.NEXT_PUBLIC_API_URL || "/api/v1";

  if (!token) {
    throw new ApiError(
      401,
      "Authentication is required",
    );
  }

  const headers = new Headers(
    init.headers,
  );

  headers.set(
    "Authorization",
    `Bearer ${token}`,
  );

  if (init.body) {
    headers.set(
      "Content-Type",
      "application/json",
    );
  }

  const cleanBase = base.replace(
    /\/$/,
    "",
  );

  const cleanPath = path.startsWith("/")
    ? path
    : `/${path}`;

  const response = await fetch(
    `${cleanBase}${cleanPath}`,
    {
      ...init,
      headers,
      cache: "no-store",
    },
  );

  if (!response.ok) {
    let detail: unknown = null;

    if (response.status === 409) {
      try {
        const body: unknown =
          await response.json();

        if (
          body !== null &&
          typeof body === "object" &&
          "detail" in body
        ) {
          detail = body.detail;
        }
      } catch {
        // Preserve the original HTTP
        // failure if no JSON body exists.
      }
    }

    throw new ApiError(
      response.status,
      response.status === 401
        ? "Your session has expired. Please sign in again."
        : response.status === 403
          ? "You do not have permission to perform this action."
          : `API request failed (${response.status})`,
      detail,
    );
  }

  return (await response.json()) as T;
}