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
  // All browser API traffic goes through the same-origin Next.js proxy.
  //
  // Do not introduce NEXT_PUBLIC_API_URL here. A public build-time API
  // variable caused local/deployment environments to silently bypass the
  // runtime proxy and point at stale backend ports.
  const base =
    "/api/v1";

  if (!token) {
    throw new ApiError(
      401,
      "Authentication is required",
    );
  }

  const headers =
    new Headers(
      init.headers,
    );

  headers.set(
    "Authorization",
    `Bearer ${token}`,
  );

  // JSON requests need an explicit Content-Type.
  //
  // FormData must NOT receive one manually because the browser generates
  // the multipart boundary.
  if (
    init.body &&
    !(init.body instanceof FormData)
  ) {
    headers.set(
      "Content-Type",
      "application/json",
    );
  }

  const cleanPath =
    path.startsWith("/")
      ? path
      : `/${path}`;

  const response =
    await fetch(
      `${base}${cleanPath}`,
      {
        ...init,
        headers,
        cache: "no-store",
      },
    );

  if (!response.ok) {
    let detail:
      unknown = null;

    try {
      const body:
        unknown =
        await response.json();

      if (
        body !== null &&
        typeof body === "object" &&
        "detail" in body
      ) {
        detail =
          body.detail;
      }
    } catch {
      // Preserve the original HTTP error if the response has no JSON body.
    }

    let message =
      `API request failed (${response.status})`;

    if (
      response.status === 401
    ) {
      message =
        "Your session has expired. Please sign in again.";

    } else if (
      response.status === 403
    ) {
      message =
        "You do not have permission to perform this action.";

    } else if (
      response.status === 502
    ) {
      message =
        "The backend API is unavailable. Make sure FastAPI is running.";

    } else if (
      typeof detail ===
      "string"
    ) {
      message =
        detail;
    }

    throw new ApiError(
      response.status,
      message,
      detail,
    );
  }

  if (
    response.status ===
    204
  ) {
    return undefined as T;
  }

  return (
    await response.json()
  ) as T;
}