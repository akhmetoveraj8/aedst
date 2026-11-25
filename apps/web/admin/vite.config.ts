import path from "node:path";
import { fileURLToPath } from "node:url";
import babel from "@rolldown/plugin-babel";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

import { adminAliases } from "./vite.aliases.ts";

const root = path.dirname(fileURLToPath(import.meta.url));

// The shared kit reads its public settings as `process.env.NEXT_PUBLIC_<NAME>`
// (shared/env/client.ts, validated once with Zod). The browser has no
// `process`, so each of these is replaced at build time by `VITE_<NAME>`:
// one validated source, a Vite-style name for the operator.
const SHARED_PUBLIC_ENV = [
  "SITE_URL",
  "SENTRY_DSN",
  "SENTRY_ENVIRONMENT",
  "SENTRY_TRACES_SAMPLE_RATE",
  "SENTRY_REPLAY_SESSION_SAMPLE_RATE",
  "SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE",
  "POSTHOG_KEY",
  "POSTHOG_HOST",
  "PRIVACY_POLICY_URL",
  "GOOGLE_SITE_VERIFICATION",
  "BING_SITE_VERIFICATION",
] as const;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, "");
  const define = Object.fromEntries(
    SHARED_PUBLIC_ENV.map((name) => {
      const value = env[`VITE_${name}`];
      return [
        `process.env.NEXT_PUBLIC_${name}`,
        value ? JSON.stringify(value) : "undefined",
      ];
    }),
  );
  const uploadSourcemaps = Boolean(env["SENTRY_AUTH_TOKEN"]);
  const releaseName = env["SENTRY_RELEASE"] || env["GITHUB_SHA"];

  return {
    plugins: [
      // Must run before the React plugin: it generates src/app/routeTree.gen.ts
      // and splits every route component into its own lazy chunk.
      tanstackRouter({
        target: "react",
        autoCodeSplitting: true,
        routesDirectory: "./src/app/routes",
        generatedRouteTree: "./src/app/routeTree.gen.ts",
      }),
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      uploadSourcemaps
        ? sentryVitePlugin({
            ...(env["SENTRY_ORG"] ? { org: env["SENTRY_ORG"] } : {}),
            ...(env["SENTRY_PROJECT"]
              ? { project: env["SENTRY_PROJECT"] }
              : {}),
            ...(env["SENTRY_AUTH_TOKEN"]
              ? { authToken: env["SENTRY_AUTH_TOKEN"] }
              : {}),
            release: releaseName ? { name: releaseName } : {},
            sourcemaps: { filesToDeleteAfterUpload: ["dist/**/*.map"] },
            telemetry: false,
          })
        : null,
    ],
    resolve: { alias: adminAliases(root) },
    define,
    // `<meta property="csp-nonce">` and the nonce on every emitted tag: the
    // BFF replaces this exact placeholder per request in index.html.
    html: { cspNonce: "__CSP_NONCE__" },
    build: {
      outDir: "dist",
      sourcemap: uploadSourcemaps ? "hidden" : false,
    },
    server: {
      port: 3001,
      strictPort: true,
      // shared/ is a sibling directory of this project.
      fs: { allow: [path.resolve(root, "..")] },
      // /api/** (auth, rpc, healthz) is the BFF's.
      proxy: {
        "/api": { target: env["ADMIN_BFF_URL"] || "http://localhost:3101" },
      },
    },
  };
});
