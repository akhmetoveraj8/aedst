// Mutation testing for the pure-logic core of src/shared/lib. Nightly only
// (web-ci `mutation` job), never per PR: a run takes minutes.
// Versions: @stryker-mutator/core + vitest-runner 10.0.0, checked on npm 2026-10-09.
// Only the node-environment tests run (vitest.mutation.config.mts); the
// browser-mode and *.tsx tests are out of reach of the runner.
// thresholds.break is "first measured score minus 5": set it after the first
// CI run (see docs/content/web/architecture.md, "Quality gates") and ratchet up.

/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  // The vitest-runner plugin (10.0.0) cannot activate runtime mutants under
  // Vitest 5.0.x (only static mutants were killed, score 5%: values it injects per
  // mutant never reach the worker). The command runner works with any Vitest:
  // each mutant runs the node test slice once, coverageAnalysis must be off.
  testRunner: "command",
  commandRunner: {
    command:
      "node ./node_modules/vitest/vitest.mjs run --config vitest.mutation.config.mts --bail=1",
  },
  mutate: [
    "../shared/lib/errors/**/*.ts",
    "../shared/lib/auth/**/*.ts",
    "../shared/lib/forms/**/*.ts",
    "../shared/lib/outbox/**/*.ts",
    "!src/**/*.test.ts",
    "!src/**/*.test-support.ts",
    "!src/**/*.browser.test.ts",
    "!src/**/*.d.ts",
  ],
  // TypeScript 7 has no JS compiler API, which Stryker's sandbox tsconfig
  // rewrite calls. Pointing tsconfigFile at a file that does not exist skips
  // the rewrite; vitest never reads the sandbox tsconfig (esbuild transpiles).
  // Never use `inPlace`: it rewrites the working tree and would clobber
  // concurrent edits.
  tsconfigFile: "tsconfig.stryker-none.json",
  // The contract replay tests import ../../../../../docs/contract; the sandbox must
  // sit as deep as apps/web so that path still resolves to the repo root.
  tempDirName: "../../.stryker-tmp",
  // Keep the sandbox small and away from directories other processes write to.
  ignorePatterns: [
    ".next",
    "coverage",
    "playwright-report",
    "test-results",
    "storybook-static",
    "reports",
    "e2e",
    "deployments",
    "public",
  ],
  // Each mutant starts a fresh Vitest process (seconds on a loaded runner): the
  // default timeout derived from the dry run flags almost every mutant as timed out.
  timeoutMS: 180000,
  concurrency: 4,
  coverageAnalysis: "off",
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/index.html" },
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  // high/low only color the report; `break` fails the run. Initial value is a
  // placeholder floor until the first nightly run records the real score.
  thresholds: { high: 80, low: 60, break: 40 },
};
