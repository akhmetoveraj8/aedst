import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/rpc/[...path]/route";
import { CLIENT_ID } from "@/shared/api/connect/client-id";
import { fakeJwt } from "@/test/jwt";
import { TEST_API_ORIGIN } from "@/test/mocks/connect";
import { server } from "@/test/mocks/server";
import contract from "../../../../../../docs/contract/behavior/client-version-gate.json";

/**
 * Replays docs/contract/behavior/client-version-gate.json for the web client.
 * The gate itself lives in apps/server (replayed there); what web owes is the
 * client half: every first-party request carries `X-Aedst-Client: web/<semver>`
 * (the browser's own value is never trusted or forwarded), and that version
 * passes the contract's configured minimum. Web has no forced-upgrade screen
 * (`ui: upgrade_screen` is native-only; a web client updates on deploy).
 */
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name) } : undefined,
  }),
}));

const PROCEDURE = "aedst.tasks.v1.TasksService/ListTasks";

function compareSemver(a: string, b: string) {
  const [left, right] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) {
    const delta = (left?.[i] ?? 0) - (right?.[i] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

async function outboundHeader(inbound: string | null) {
  jar.set("aedst_session", fakeJwt({ expiresInSeconds: 600 }));
  let seen: string | null = null;
  server.use((routes) => {
    routes.set(`POST ${TEST_API_ORIGIN}/${PROCEDURE}`, (request) => {
      seen = request.headers.get("x-aedst-client");
      return Response.json({ tasks: [] });
    });
  });
  const headers: Record<string, string> = {
    "content-type": "application/json",
    host: "localhost:3000",
    origin: "http://localhost:3000",
  };
  if (inbound !== null) {
    headers["x-aedst-client"] = inbound;
  }
  await POST(
    new Request(`http://localhost:3000/api/rpc/${PROCEDURE}`, {
      method: "POST",
      headers,
      body: "{}",
    }),
    { params: Promise.resolve({ path: PROCEDURE.split("/") }) },
  );
  return seen;
}

beforeEach(() => {
  jar.clear();
});

describe("client-version-gate contract (web side)", () => {
  it("identifies as web/<semver> with a version the contract's minimum accepts", () => {
    const [platform, version] = CLIENT_ID.split("/");
    expect(platform).toBe("web");
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(
      compareSemver(version ?? "", contract.minVersions.web),
    ).toBeGreaterThanOrEqual(0);
  });

  it.each(contract.cases)(
    "$id: the proxy sends its own identity, not the browser's ($header)",
    async ({ header }) => {
      expect(await outboundHeader(header)).toBe(CLIENT_ID);
    },
  );
});
