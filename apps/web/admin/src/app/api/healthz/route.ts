// Liveness/readiness probe for the container (Dockerfile HEALTHCHECK, Helm
// probes). Deliberately independent of apps/server, the IdP and the session:
// a backend outage must not make the orchestrator restart healthy web pods.
// `proxy.ts` only stamps the static API CSP on `/api/*` (no session, no I/O).
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { status: "ok" },
    { headers: { "cache-control": "no-store" } },
  );
}

export function HEAD() {
  return new Response(null, { headers: { "cache-control": "no-store" } });
}
