import { withSentryConfig } from "@sentry/nextjs/config";
import { withSerwist } from "@serwist/turbopack";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/app/config/i18n/request.ts");

// Content-Security-Policy is deliberately NOT set here: `src/proxy.ts` (built
// by `src/app/config/security/csp.ts`) is the single place that emits it, for
// pages (per-request nonce), `/api/*` and `/serwist/*`. A second static CSP
// header would be intersected with it by browsers. Only headers that are the
// same for every response and are not a CSP are static here.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // Camera stays available to this origin only: the media uploader's
    // file picker can offer "take a photo" on phones.
    value:
      "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const SHARED_METADATA_CACHE =
  "public, s-maxage=3600, stale-while-revalidate=86400";

/**
 * PostHog reverse proxy: the browser posts to `/ingest/*` on this origin and
 * Next forwards it to PostHog, so ad blockers that block PostHog's hostnames
 * do not drop events and the CSP needs no PostHog origin. Only wired when a
 * project key is configured.
 */
function posthogRewrites() {
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    return [];
  }
  const ingest = new URL(
    process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com",
  );
  const assets = new URL(ingest);
  assets.hostname = ingest.hostname.replace(
    ".i.posthog.com",
    "-assets.i.posthog.com",
  );
  return [
    {
      source: "/ingest/static/:path*",
      destination: `${assets.origin}/static/:path*`,
    },
    {
      source: "/ingest/array/:path*",
      destination: `${assets.origin}/array/:path*`,
    },
    { source: "/ingest/:path*", destination: `${ingest.origin}/:path*` },
  ];
}

const nextConfig: NextConfig = {
  reactCompiler: true,
  // The Playwright suite drives the dev server through 127.0.0.1; Next blocks
  // dev-only resources (HMR) from origins not listed here.
  allowedDevOrigins: ["127.0.0.1"],
  poweredByHeader: false,
  // Self-contained `.next/standalone/server.js` for the container image
  // (deployments/docker/Dockerfile). apps/web is its own pnpm project with its
  // own lockfile, so the default tracing root (this directory) is correct:
  // no outputFileTracingRoot is needed. Vercel ignores this option.
  output: "standalone",
  // PostHog's API paths end in a slash (`/e/`, `/flags/?v=2`); Next's
  // trailing-slash redirect would otherwise break the `/ingest` proxy.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return posthogRewrites();
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // JSON responses (the /api/rpc proxy) must never be cached.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        // Crawler and metadata files change rarely: let a CDN hold them for an
        // hour and serve stale while it revalidates. The opengraph-image
        // route is per locale; llms*.txt are served by route handlers.
        source: "/robots.txt",
        headers: [{ key: "Cache-Control", value: SHARED_METADATA_CACHE }],
      },
      {
        source: "/sitemap.xml",
        headers: [{ key: "Cache-Control", value: SHARED_METADATA_CACHE }],
      },
      {
        source: "/llms.txt",
        headers: [{ key: "Cache-Control", value: SHARED_METADATA_CACHE }],
      },
      {
        source: "/llms-full.txt",
        headers: [{ key: "Cache-Control", value: SHARED_METADATA_CACHE }],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: SHARED_METADATA_CACHE }],
      },
      {
        source: "/:locale/opengraph-image",
        headers: [{ key: "Cache-Control", value: SHARED_METADATA_CACHE }],
      },
      {
        // The service worker must never be served stale (an old worker
        // would keep serving an old app), and it only ever runs our code.
        source: "/serwist/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(withSerwist(withNextIntl(nextConfig)), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Release = commit SHA in CI (GITHUB_SHA) unless SENTRY_RELEASE overrides
  // it; the SDK injects the same value at runtime, which is what ties an
  // event to its uploaded source maps and to "suspect commits".
  release: {
    name:
      process.env.SENTRY_RELEASE ||
      process.env.GITHUB_SHA ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      undefined,
  },
  sourcemaps: {
    // Without an auth token there's nothing to authenticate the upload with,
    // so skip it entirely instead of failing (or noisily warning) local builds.
    disable: !process.env.SENTRY_AUTH_TOKEN,
    // Source maps are uploaded to Sentry, then deleted from the build output,
    // so they are never served publicly.
    deleteSourcemapsAfterUpload: true,
  },
  silent: !process.env.CI,
  // Readable stack traces through Next.js-internal frames too, at the cost
  // of a longer source-map upload — worth it while this is still a small app.
  widenClientFileUpload: true,
  // Routes the client SDK's beacon through our own server instead of
  // Sentry's ingest domain directly, so ad blockers that block known
  // Sentry hostnames don't silently drop events. Requires `src/proxy.ts`'s
  // matcher to exclude this path (next-intl's middleware would otherwise
  // 30x-redirect it to add a locale prefix, breaking the tunnel) — see the
  // `monitoring` exclusion there.
  tunnelRoute: "/monitoring",
  // Replay's iframe/shadow-DOM recording is unused here; dropping it trims the
  // (lazy, consent-gated) replay chunk.
  bundleSizeOptimizations: {
    excludeReplayIframe: true,
    excludeReplayShadowDom: true,
  },
});
