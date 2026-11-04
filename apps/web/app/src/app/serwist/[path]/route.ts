import { createSerwistRoute } from "@serwist/turbopack";

import { serverEnv } from "@/shared/env/server";
import { locales } from "@/shared/i18n/locales";

/**
 * Serves the service worker (`/serwist/sw.js`, built from `src/app/sw.ts`
 * by esbuild with the precache manifest injected) as a static route — the
 * Turbopack-compatible Serwist setup the Next.js PWA guide points to. Kept
 * outside `[locale]` and excluded from `proxy.ts`, so it is never
 * locale-redirected.
 */

// One revision per build (the route is static, so this is evaluated at
// build time): precached offline pages are refreshed on every deploy.
const revision =
  serverEnv.GITHUB_SHA || serverEnv.VERCEL_GIT_COMMIT_SHA || String(Date.now());

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    swSrc: "src/app/sw.ts",
    // Native esbuild on every OS (esbuild-wasm is not installed).
    useNativeEsbuild: true,
    // Classic (IIFE) worker: module service workers are not supported by
    // every browser in `browserslist` (Firefox < 147).
    // No public source map for the worker (same policy as the app bundles).
    // `tsconfig` is explicit: esbuild resolves `paths` per file, and the files
    // under ../shared have no tsconfig of their own (the `@/shared/*` alias).
    esbuildOptions: {
      format: "iife",
      sourcemap: false,
      tsconfig: "tsconfig.json",
    },
    // Precache only what the offline experience needs: public/ files and the
    // localized offline pages. Build chunks are cached at runtime on first
    // use (CacheFirst, content-hashed) instead of downloading every route's
    // JS — admin, replay, analytics — on a visitor's first page view.
    globPatterns: ["public/**/*"],
    // The localized offline pages are the navigation fallback.
    additionalPrecacheEntries: locales.map((locale) => ({
      url: `/offline/${locale}`,
      revision,
    })),
  });
