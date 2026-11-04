import { Hono } from "hono";

import type { AppBindings } from "../types";

// Liveness/readiness probe for the container (Dockerfile HEALTHCHECK, Helm
// probes). Deliberately independent of apps/server, the IdP and the session:
// a backend outage must not make the orchestrator restart healthy web pods.
export const healthRoutes = new Hono<AppBindings>().get("/api/healthz", (c) => {
  c.header("cache-control", "no-store");
  return c.json({ status: "ok" });
});
