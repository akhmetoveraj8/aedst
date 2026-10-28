#!/usr/bin/env node
// `pnpm start`: serve the production build the way the container does.
//
// next.config.ts sets `output: "standalone"`, for which `next start` is not
// supported (it prints a warning and serves from a different file set than
// production). The standalone server does not copy `.next/static` or `public`
// itself, so this script copies them next to it first, then runs server.js.
//
//   pnpm start [--port 3100] [--hostname 0.0.0.0]
import { spawn } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// The workspace lockfile sits in apps/web, so Next traces from there and the
// project lands in a subfolder: .next/standalone/app/server.js.
const standalone = join(root, ".next", "standalone", "app");
const server = join(standalone, "server.js");

if (!existsSync(server)) {
  console.error("No standalone build found: run `pnpm build` first.");
  process.exit(2);
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

for (const [from, to] of [
  [join(root, ".next", "static"), join(standalone, ".next", "static")],
  [join(root, "public"), join(standalone, "public")],
]) {
  if (existsSync(from)) {
    // Always refresh: a stale copy from an older build would serve old chunks.
    rmSync(to, { recursive: true, force: true });
    cpSync(from, to, { recursive: true });
  }
}

// `next start` loaded .env files from the app directory; the standalone server
// runs from its own folder and would not. process.loadEnvFile never overrides a
// variable that is already set, so load the highest-priority file first.
for (const file of [
  ".env.production.local",
  ".env.local",
  ".env.production",
  ".env",
]) {
  const path = join(root, file);
  if (existsSync(path)) {
    process.loadEnvFile(path);
  }
}

const child = spawn(process.execPath, [server], {
  cwd: standalone,
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: option("port") ?? process.env.PORT ?? "3000",
    HOSTNAME: option("hostname") ?? process.env.HOSTNAME ?? "0.0.0.0",
  },
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code) => process.exit(code ?? 0));
