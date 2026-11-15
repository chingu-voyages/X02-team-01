import type { NextConfig } from "next";

// Browser login/registration requests use the same-origin
// `/api/v1/...` path. The same-origin proxy lives in
// src/app/api/v1/[...path]/route.ts, which reads BACKEND_PROXY_TARGET
// per request (defaults to the local FastAPI port).
//
// Why not next.config rewrites: their destinations are baked into the
// build's routes manifest. A deployment whose build environment lacks
// BACKEND_PROXY_TARGET (e.g. Render's docker runtime does not pass env
// vars into builds) permanently proxies to the localhost fallback —
// the runtime env var is never consulted. The route handler reads the
// env at request time, so the target is genuinely runtime-configurable.

const nextConfig: NextConfig = {
  output: "standalone",

  cacheComponents: true,
  partialPrefetching: true,

  turbopack: {
    rules: {
      "*.css": {
        loaders: [
          "@tailwindcss/turbopack",
        ],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;