import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/app/config/i18n/request.ts");

const isDev = process.env.NODE_ENV !== "production";

/**
 * Content-Security-Policy for a fully static site (no per-request nonce).
 *
 * Next's own guidance for apps WITHOUT nonces is a static header in
 * next.config (nonces force dynamic rendering, which this site must not
 * have). The one directive that cannot be fully strict is `script-src`:
 * Next streams its hydration payload (`self.__next_f.push(...)`) and the
 * theme no-flash script as inline scripts, and a static page has no request
 * to bind a nonce or a hash to. So scripts are `'self' 'unsafe-inline'`, and
 * everything that makes inline script dangerous is closed instead: no
 * `unsafe-eval` in production, no third-party origin at all, `object-src
 * none`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`.
 * JSON-LD is `application/ld+json` (data, never executed). The stricter path
 * (hash/SRI based, no `unsafe-inline`) is Next's `experimental.sri` and is
 * NOT enabled here because it is unverified for Turbopack builds; revisit
 * when Lighthouse `csp-xss` must be green (docs/content/decisions/web.md).
 * Any new third-party origin must be added here in the same change.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  // next/font and Tailwind emit inline <style>; styles cannot execute code.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
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
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const SHARED_METADATA_CACHE =
  "public, s-maxage=3600, stale-while-revalidate=86400";

const nextConfig: NextConfig = {
  reactCompiler: true,
  poweredByHeader: false,
  // Self-contained `.next/standalone` for the container image
  // (deployments/docker/Dockerfile). Vercel ignores this option.
  output: "standalone",
  // ../shared (the source-only kit) lives outside this project: Turbopack must
  // resolve and compile it, and standalone tracing must include it.
  turbopack: { root: path.resolve(import.meta.dirname, "..") },
  outputFileTracingRoot: path.resolve(import.meta.dirname, ".."),
  // OG image fonts are read with fs at build/run time (src/app/config/og-fonts.ts).
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/@fontsource/noto-sans/files/*.woff",
      "./node_modules/@fontsource/ibm-plex-sans-arabic/files/*.woff",
    ],
  },
  allowedDevOrigins: ["127.0.0.1"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      ...[
        "/robots.txt",
        "/sitemap.xml",
        "/llms.txt",
        "/manifest.webmanifest",
        "/:locale/opengraph-image",
      ].map((source) => ({
        source,
        headers: [{ key: "Cache-Control", value: SHARED_METADATA_CACHE }],
      })),
    ];
  },
};

export default withNextIntl(nextConfig);
