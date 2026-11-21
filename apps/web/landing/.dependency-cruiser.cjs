/**
 * Import-graph gate for apps/web/landing (`pnpm check:deps`, run as
 * `depcruise src ../shared`). Biome stays the only linter/formatter of code;
 * dependency-cruiser only analyses the import graph.
 * Direction: src/app -> src/modules -> ../shared. Paths are relative to this
 * directory, so the source-only kit is `^../shared/`. The authoritative boundary
 * gate is `pnpm check:feature-boundaries` (dependency-cruiser cannot load
 * TypeScript 7.0, see docs/content/decisions/web.md).
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
      name: "no-other-web-project",
      severity: "error",
      comment:
        "landing is an independent deployable: it never imports the app or admin projects. They meet only in ../shared and over the network.",
      from: { path: "^(src|\\.\\./shared)/" },
      to: { path: "^\\.\\./(app|admin)/" },
    },
    {
      name: "modules-to-shared-only",
      severity: "error",
      comment:
        "A feature module never imports another module or src/app; modules meet in ../shared.",
      from: { path: "^src/modules/([^/]+)/" },
      to: { path: ["^src/modules/(?!$1/)", "^src/app/"] },
    },
    {
      name: "feature-not-to-other-feature",
      severity: "error",
      comment:
        "A feature (src/modules/<m>/features/<f>) never imports another feature; shared code moves to the module's lib/ or ui/.",
      from: { path: "^src/modules/([^/]+)/features/([^/]+)/" },
      to: { path: "^src/modules/$1/features/(?!$2/)" },
    },
    {
      name: "module-shared-not-to-feature",
      severity: "error",
      comment:
        "A module's shared code (lib/, ui/, any folder but features/ and entries/) never imports a feature; only entries/, public.ts, outbox.ts and module-root tests compose features.",
      from: { path: "^src/modules/([^/]+)/(?!features/|entries/)[^/]+/" },
      to: { path: "^src/modules/$1/features/" },
    },
    {
      name: "no-shared-to-app-or-modules",
      severity: "error",
      comment:
        "../shared is the bottom layer: it imports neither src/app nor src/modules.",
      from: { path: "^\\.\\./shared/", pathNot: TEST_FILE },
      to: { path: ["^src/app/", "^src/modules/"] },
    },
    {
      name: "module-public-entry-only",
      severity: "error",
      comment:
        "Code outside a module imports only its public.ts, manifest.ts or entries/*.ts (type-only catalogue imports are exempt).",
      from: {
        path: "^src/",
        pathNot: ["^src/modules/", TEST_FILE, "^src/test/", "\\.d\\.ts$"],
      },
      to: {
        path: "^src/modules/[^/]+/",
        pathNot: "^src/modules/[^/]+/(public|manifest|entries/[^/]+)\\.ts$",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "manifest-imports-shared-only",
      severity: "error",
      comment:
        "A module manifest is loaded eagerly: it may import only ../shared (and packages).",
      from: { path: "^src/modules/[^/]+/manifest\\.ts$" },
      to: { path: "^src/" },
    },
    {
      name: "not-to-dev-dep",
      severity: "error",
      comment: "Shipped code must not depend on a devDependency.",
      from: { path: "^src/", pathNot: [TEST_FILE, "^src/test/"] },
      to: { dependencyTypes: ["npm-dev"] },
    },
    {
      name: "no-orphans",
      severity: "error",
      comment:
        "A module nothing imports is dead code (knip covers exports; this covers whole files).",
      from: {
        orphan: true,
        path: "^src/",
        pathNot: [
          TEST_FILE,
          "\\.d\\.ts$",
          "^src/test/",
          "^src/app/", // Next.js file-system routing and config entry points
          "^src/(instrumentation|instrumentation-client|proxy)\\.ts$",
          // The declared full surface; pages import the single-export entries/ files.
          "^src/modules/[^/]+/public\\.ts$",
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: ["generated/"] },
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
