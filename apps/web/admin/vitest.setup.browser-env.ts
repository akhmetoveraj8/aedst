// Runs first in the `browser` project. Some framework code that reaches the
// bundle (Next's shared runtime via @sentry/nextjs / next-intl) reads
// `process.env` at module scope, which does not exist in a real browser. Next
// itself inlines these at build time; here we provide the same minimal shape.
const globals = globalThis as unknown as {
  process?: { env: Record<string, string | undefined> };
};
globals.process ??= { env: {} };
globals.process.env.NODE_ENV ??= "test";
