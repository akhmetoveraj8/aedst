// Runs first in the `browser` project. The shared kit reads
// `process.env.NEXT_PUBLIC_*` at module scope (vite.config.ts replaces those at
// build time), which does not exist in a real browser; provide the minimal shape.
const globals = globalThis as unknown as {
  process?: { env: Record<string, string | undefined> };
};
globals.process ??= { env: {} };
globals.process.env["NODE_ENV"] ??= "test";
