import type { NextConfig } from "next";

// Browser login/registration requests use the same-origin
// `/api/v1/...` path. Next proxies them to FastAPI.
//
// Keep the default aligned with NEXT_PUBLIC_API_URL so both
// authentication requests and authenticated API requests use
// the same local backend port.
const backendProxyTarget =
  process.env.BACKEND_PROXY_TARGET ??
  "http://127.0.0.1:8000";

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

  async rewrites() {
    return [
      {
        source:
          "/api/v1/:path*",
        destination:
          `${backendProxyTarget}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;