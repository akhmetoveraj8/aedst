// esbuild options for the BFF bundle, shared by build.mjs and dev.mjs.
// esbuild rather than Node type stripping: the shared kit is imported through
// the `@/shared/*` alias and extensionless paths, neither of which Node
// resolves; the bundle also leaves the image with no node_modules to copy.
export const bundleOptions = {
  entryPoints: ["server/main.ts"],
  outfile: "dist-server/main.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: "linked",
  legalComments: "none",
  tsconfig: "server/tsconfig.json",
  // `server-only` throws outside React Server Components.
  alias: { "server-only": "./server/stubs/server-only.ts" },
  // CommonJS dependencies of the bundle need require() in an ES module.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: "info",
};
