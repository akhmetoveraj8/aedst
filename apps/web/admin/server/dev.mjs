// Dev runner: rebuilds the BFF bundle on change, restarts it with `node
// --watch`, and (with --vite) runs the Vite dev server next to it. Vite
// (port 3001) proxies /api to the BFF (ADMIN_BFF_PORT, default 3101).
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { context } from "esbuild";

import { bundleOptions } from "./bundle-options.mjs";

const withVite = process.argv.includes("--vite");
const children = [];

const ctx = await context({ ...bundleOptions, logLevel: "warning" });
await ctx.rebuild();
await ctx.watch();

children.push(
  spawn(
    process.execPath,
    ["--watch", "--env-file-if-exists=.env.local", "dist-server/main.mjs"],
    { stdio: "inherit", env: { ...process.env, NODE_ENV: "development" } },
  ),
);
if (withVite) {
  // Run Vite's own JS entry with this Node binary: no shell and no
  // platform-specific .cmd shim, so it behaves the same on Windows and Unix.
  const require = createRequire(import.meta.url);
  const vitePackage = require.resolve("vite/package.json");
  const viteBin = join(dirname(vitePackage), require(vitePackage).bin.vite);
  children.push(spawn(process.execPath, [viteBin], { stdio: "inherit" }));
}

const stop = () => {
  for (const child of children) {
    child.kill("SIGTERM");
  }
  void ctx.dispose().then(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children) {
  child.on("exit", stop);
}
