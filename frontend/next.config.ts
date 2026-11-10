import type { NextConfig } from "next";

// JHEP-24/JHEP-99: browser pages call the API same-origin (`/api/v1/...`),
// and the Next server proxies those calls to the FastAPI backend. This
// keeps components free of absolute API URLs — set BACKEND_PROXY_TARGET
// per environment (defaults to the local FastAPI port). The proxy runs at
// request time, so the target follows the runtime env, not the build.
const backendProxyTarget =
  process.env.BACKEND_PROXY_TARGET ?? "http://127.0.0.1:8010";

const nextConfig: NextConfig = {
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${backendProxyTarget}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
