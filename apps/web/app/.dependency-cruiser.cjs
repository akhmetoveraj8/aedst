/**
 * Import-graph gate for apps/web (`pnpm check:deps`). Biome stays the only
 * linter/formatter of code; dependency-cruiser only analyses the import graph.
 * Direction: app -> modules -> shared. Rationale: docs/content/web/architecture.md
 * ("Quality gates") and docs/content/decisions/web.md (revised by owner 2026-10).
 * The bash script scripts/check-feature-boundaries.sh keeps the manifest/flags rules.
 */

const TEST_FILE =
  "(\\.test\\.[jt]sx?|\\.browser\\.test\\.ts|\\.stories\\.tsx)$";

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Import cycles make module load order fragile.",
      from: {},
      to: { circular: true },
    },
    {
      name: "modules-to-shared-only",
      severity: "error",
      comment:
        "A feature module never imports another module or src/app; modules meet in src/shared.",
      from: { path: "^src/modules/([^/]+)/" },
      to: { path: ["^src/modules/(?!$1/)", "^src/app/"] },
    },
    {
      name: "no-shared-to-app-or-modules",
      severity: "error",
      comment:
        "src/shared is the bottom layer: it imports neither src/app nor src/modules.",
      from: { path: "^\\.\\./shared/", pathNot: TEST_FILE },
      to: { path: ["^src/app/", "^src/modules/"] },
    },
    {
      name: "module-public-entry-only",
      severity: "error",
      comment:
        "Code outside a module imports only its public.ts, manifest.ts or outbox.ts (type-only catalogue imports are exempt).",
      from: {
        path: "^(src|\\.\\./shared)/",
        pathNot: ["^src/modules/", TEST_FILE, "^src/test/", "\\.d\\.ts$"],
      },
      to: {
        path: "^src/modules/[^/]+/",
        pathNot:
          "^src/modules/[^/]+/(public|manifest|outbox|entries/[^/]+)\\.ts$",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "manifest-imports-shared-only",
      severity: "error",
      comment:
        "A module manifest is loaded eagerly: it may import only @/shared (and packages).",
      from: { path: "^src/modules/[^/]+/manifest\\.ts$" },
      to: { path: "^(src|\\.\\./shared)/", pathNot: "^\\.\\./shared/" },
    },
    {
      name: "not-to-dev-dep",
      severity: "error",
      comment: "Shipped code must not depend on a devDependency.",
      from: {
        path: "^(src|\\.\\./shared)/",
        pathNot: [
          TEST_FILE,
          "^src/test/",
          "\\.stories\\.tsx$",
          // Dev-only dynamic import (isDevelopment), tree-shaken from production.
          "^src/app/providers/QueryProvider\\.tsx$",
        ],
      },
      to: { dependencyTypes: ["npm-dev"] },
    },
    {
      name: "no-orphans",
      severity: "error",
      comment:
        "A module nothing imports is dead code (knip covers exports; this covers whole files).",
      from: {
        orphan: true,
        path: "^(src|\\.\\./shared)/",
        pathNot: [
          TEST_FILE,
          "\\.d\\.ts$",
          "^src/test/",
          "^\\.\\./shared/ui/",
          "^src/app/", // Next.js file-system routing and config entry points
          "^src/(instrumentation|instrumentation-client|proxy)\\.ts$",
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: ["^\\.\\./shared/api/connect/generated/"] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main", "types", "typings"],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
