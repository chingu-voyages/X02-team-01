const localBackend =
  "http://127.0.0.1:8010";


function backendProxyTarget() {
  const configured =
    process.env
      .BACKEND_PROXY_TARGET
      ?.trim();

  const rawTarget =
    configured ||
    localBackend;

  let target =
    rawTarget.replace(
      /\/+$/,
      "",
    );

  // Be forgiving if somebody configures:
  //
  // BACKEND_PROXY_TARGET=http://127.0.0.1:8010/api/v1
  //
  // The proxy itself owns the /api/v1 prefix.
  target =
    target.replace(
      /\/api\/v1$/,
      "",
    );

  return target;
}


const hopByHopHeaders =
  new Set([
    "host",
    "connection",
    "keep-alive",
    "transfer-encoding",
    "upgrade",
    "content-length",
  ]);


async function proxy(
  request: Request,
  ctx: {
    params: Promise<{
      path: string[];
    }>;
  },
): Promise<Response> {
  const {
    path,
  } =
    await ctx.params;

  const search =
    new URL(
      request.url,
    ).search;

  const target =
    backendProxyTarget();

  const url =
    `${target}/api/v1/${path
      .map(
        encodeURIComponent,
      )
      .join("/")}${search}`;

  const headers =
    new Headers(
      request.headers,
    );

  for (
    const header
    of hopByHopHeaders
  ) {
    headers.delete(
      header,
    );
  }

  let body:
    ArrayBuffer | undefined;

  if (
    request.method !==
      "GET" &&
    request.method !==
      "HEAD"
  ) {
    body =
      await request.arrayBuffer();
  }

  try {
    const upstream =
      await fetch(
        url,
        {
          method:
            request.method,

          headers,

          body,

          redirect:
            "manual",

          cache:
            "no-store",
        },
      );

    const responseHeaders =
      new Headers(
        upstream.headers,
      );

    for (
      const header
      of hopByHopHeaders
    ) {
      responseHeaders.delete(
        header,
      );
    }

    return new Response(
      upstream.body,
      {
        status:
          upstream.status,

        headers:
          responseHeaders,
      },
    );

  } catch (error) {
    console.error(
      "Backend proxy request failed",
      {
        target,
        path:
          request.method +
          " " +
          new URL(
            request.url,
          ).pathname,

        error:
          error instanceof
            Error
            ? error.message
            : "Unknown proxy error",
      },
    );

    return Response.json(
      {
        detail:
          "Backend API is unavailable. Check BACKEND_PROXY_TARGET and make sure FastAPI is running.",
      },
      {
        status: 502,
      },
    );
  }
}


export const GET =
  proxy;

export const POST =
  proxy;

export const PUT =
  proxy;

export const PATCH =
  proxy;

export const DELETE =
  proxy;

export const HEAD =
  proxy;

export const OPTIONS =
  proxy;