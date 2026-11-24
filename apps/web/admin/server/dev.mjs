// Dev runner: rebuilds the BFF bundle on change, restarts it with `node
// --watch`, and (with --vite) runs the Vite dev server next to it. Vite
// (port 3001) proxies /api to the BFF (ADMIN_BFF_PORT, default 3101).
import { spawn } from "node:child_process";
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
  children.push(
    // security-ignore: dev-only launcher, constant arguments; Windows needs a shell to run pnpm.cmd
    spawn("pnpm", ["exec", "vite"], { stdio: "inherit", shell: true }),
  );
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
