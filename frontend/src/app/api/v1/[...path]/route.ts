// JHEP-99: same-origin API proxy. The browser calls `/api/v1/...` and this
// handler forwards it to the FastAPI backend at request time.
//
// Why a route handler instead of next.config rewrites: `rewrites()`
// destinations are baked into the build's routes manifest, so a deployment
// whose build environment lacks BACKEND_PROXY_TARGET (e.g. Render's docker
// runtime, which does not pass env vars into builds) permanently proxies to
// the fallback localhost target. Reading the env per request here makes the
// target genuinely runtime-configurable in every environment.
const backendProxyTarget = () =>
  process.env.BACKEND_PROXY_TARGET ?? "http://127.0.0.1:8010";

const hopByHopHeaders = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "content-length",
]);

async function proxy(
  request: Request,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await ctx.params;
  const search = new URL(request.url).search;
  const url = `${backendProxyTarget()}/api/v1/${path
    .map(encodeURIComponent)
    .join("/")}${search}`;

  const headers = new Headers(request.headers);
  for (const header of hopByHopHeaders) headers.delete(header);

  let body: ArrayBuffer | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.arrayBuffer();
  }

  const upstream = await fetch(url, {
    method: request.method,
    headers,
    body,
    redirect: "manual",
    cache: "no-store",
  });

  const responseHeaders = new Headers(upstream.headers);
  for (const header of hopByHopHeaders) responseHeaders.delete(header);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
