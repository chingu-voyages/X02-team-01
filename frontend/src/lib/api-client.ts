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
  // Default to the same-origin Next.js proxy.
  //
  // NEXT_PUBLIC_API_URL remains an optional absolute override, but because
  // NEXT_PUBLIC_* values are baked into the frontend build, deployments must
  // continue working when no override exists.
  const base =
    process.env.NEXT_PUBLIC_API_URL ||
    "/api/v1";

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

  // JSON requests need an explicit Content-Type.
  //
  // FormData MUST NOT set this manually because the browser generates the
  // multipart/form-data boundary.
  if (
    init.body &&
    !(init.body instanceof FormData)
  ) {
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
      // Preserve the original HTTP failure when the server does not return
      // JSON.
    }

    let message =
      `API request failed (${response.status})`;

    if (response.status === 401) {
      message =
        "Your session has expired. Please sign in again.";
    } else if (response.status === 403) {
      message =
        "You do not have permission to perform this action.";
    } else if (
      typeof detail === "string"
    ) {
      message = detail;
    }

    throw new ApiError(
      response.status,
      message,
      detail,
    );
  }

  // Successful DELETE routes commonly return 204 with no response body.
  if (
    response.status === 204
  ) {
    return undefined as T;
  }

  return (
    await response.json()
  ) as T;
}