import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/app/config/i18n/request.ts");

/**
 * Static export. `next build` writes the whole site to `out/`; there is no
 * Node server at runtime, so `headers()`, `redirects()` and the proxy do not
 * exist. The response headers (a CSP with one SHA-256 hash per inline script,
 * HSTS, ...) are produced after the build by
 * `scripts/build-security-headers.mjs` from the emitted HTML and served by the
 * static host (`deployments/nginx`). Rationale and operations:
 * docs/content/web/marketing-static.md.
 */
const nextConfig: NextConfig = {
  reactCompiler: true,
  poweredByHeader: false,
  output: "export",
  // The default image loader needs a server. Marketing ships no raster image
  // through next/image (the OG image and the icons are rendered at build time).
  images: { unoptimized: true },
  // ../shared (the source-only kit) lives outside this project: Turbopack must
  // resolve and compile it.
  turbopack: { root: path.resolve(import.meta.dirname, "..") },
  allowedDevOrigins: ["127.0.0.1"],
};

export default withNextIntl(nextConfig);
