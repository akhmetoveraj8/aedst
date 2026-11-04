import path from "node:path";
import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/app/config/i18n/request.ts");

// apps/web: the directory that holds admin/ AND the source-only shared/ kit
// (imported as `@/shared/*` -> ../shared/*). Turbopack and file tracing must
// both start there, or ../shared would be outside the compiled root.
const webRoot = path.resolve(import.meta.dirname, "..");

// Content-Security-Policy is deliberately NOT set here: `src/proxy.ts` (built
// by `src/app/config/security/csp.ts`) is the single place that emits it.
// Only headers that are the same for every response are static here.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  // Also sent by proxy.ts for pages; this covers static files too.
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig: NextConfig = {
  reactCompiler: true,
  allowedDevOrigins: ["127.0.0.1"],
  poweredByHeader: false,
  // Self-contained `.next/standalone/admin/server.js` for the container image
  // (deployments/docker/Dockerfile); the tracing root is apps/web, so the
  // server lives in the `admin/` subfolder of the standalone output.
  output: "standalone",
  outputFileTracingRoot: webRoot,
  turbopack: { root: webRoot },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // JSON responses (the /api/rpc proxy) must never be cached.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default withSentryConfig(withNextIntl(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  release: {
    name:
      process.env.SENTRY_RELEASE ||
      process.env.GITHUB_SHA ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      undefined,
  },
  sourcemaps: {
    // No auth token: skip the upload instead of failing local builds.
    disable: !process.env.SENTRY_AUTH_TOKEN,
    deleteSourcemapsAfterUpload: true,
  },
  silent: !process.env.CI,
  widenClientFileUpload: true,
  // Same-origin beacon so ad blockers do not drop events; proxy.ts excludes
  // `monitoring` from its matcher.
  tunnelRoute: "/monitoring",
});
