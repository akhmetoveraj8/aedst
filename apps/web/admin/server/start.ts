import path from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { env } from "./bootstrap";
import { productionDeps } from "./deps";
import { createLogger } from "./logger";

const SHUTDOWN_GRACE_MS = 10_000;

const logger = createLogger(env.LOG_LEVEL);
// dist-server/main.mjs and server/main.ts both sit next to dist/.
const projectDir = path.resolve(import.meta.dirname, "..");
const app = createApp(productionDeps({ env, logger, projectDir }));

const server = serve(
  { fetch: app.fetch, port: env.listenPort, hostname: "0.0.0.0" },
  (info) => {
    logger.info("listening", {
      port: info.port,
      origin: env.ADMIN_ORIGIN,
      env: env.NODE_ENV,
    });
  },
);

let stopping = false;
function shutdown(signal: string) {
  if (stopping) {
    return;
  }
  stopping = true;
  logger.info("shutting_down", { signal });
  const force = setTimeout(() => {
    logger.warn("shutdown_forced");
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);
  force.unref();
  server.close(() => process.exit(0));
  if ("closeIdleConnections" in server) {
    server.closeIdleConnections();
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
