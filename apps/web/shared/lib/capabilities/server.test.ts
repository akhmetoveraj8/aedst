// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CapabilitiesService } from "@/shared/api/connect/generated/aedst/capabilities/v1/capabilities_pb";
import {
  CAPABILITIES_TTL_MS,
  FAILURE_BACKOFF_MS,
  getServerCapabilities,
  resetServerCapabilities,
} from "@/shared/lib/capabilities/server";
import { rpcHandler, TEST_API_ORIGIN } from "@/test/mocks/connect";
import { server } from "@/test/mocks/server";

vi.mock("server-only", () => ({}));

let calls = 0;
let lastHeaders: Headers | null = null;
let failing = false;

beforeEach(() => {
  resetServerCapabilities();
  calls = 0;
  failing = false;
  server.use(
    rpcHandler(
      CapabilitiesService.method.getCapabilities,
      (_input, request) => {
        calls++;
        lastHeaders = request.headers;
        if (failing) {
          throw new Error("down");
        }
        return { features: { search: { enabled: false } } };
      },
    ),
  );
});

describe("getServerCapabilities", () => {
  it("asks the server once per TTL, sharing concurrent calls", async () => {
    const t0 = 1_000;
    const [a, b] = await Promise.all([
      getServerCapabilities(t0),
      getServerCapabilities(t0),
    ]);
    expect(a?.features.search?.enabled).toBe(false);
    expect(b).toBe(a);
    await getServerCapabilities(Date.now());
    expect(calls).toBe(1);
  });

  it("keeps the last known answer when a refresh fails, and backs off", async () => {
    vi.useFakeTimers();
    await getServerCapabilities(0);
    vi.setSystemTime(Date.now() + CAPABILITIES_TTL_MS + 1);
    failing = true;
    const stale = await getServerCapabilities(Date.now());
    expect(stale?.features.search?.enabled).toBe(false);
    expect(calls).toBe(2);
    await getServerCapabilities(Date.now() + FAILURE_BACKOFF_MS / 2);
    expect(calls).toBe(2);
    vi.useRealTimers();
  });

  it("falls back to null (the defaults) when nothing was ever fetched", async () => {
    failing = true;
    expect(await getServerCapabilities()).toBeNull();
  });

  it("sends the Connect protocol and client-id headers (the mock refuses calls without them)", async () => {
    await getServerCapabilities(0);
    expect(lastHeaders?.get("connect-protocol-version")).toBe("1");
    expect(lastHeaders?.get("x-aedst-client")).toMatch(/^web\//);
  });
});

describe("mock API strictness", () => {
  it("rejects a unary Connect call without Connect-Protocol-Version: 1", async () => {
    const url = `${TEST_API_ORIGIN}/aedst.capabilities.v1.CapabilitiesService/GetCapabilities`;
    const bare = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(bare.status).toBe(400);
    expect(await bare.json()).toMatchObject({ code: "invalid_argument" });

    const ok = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "connect-protocol-version": "1",
      },
      body: "{}",
    });
    expect(ok.status).toBe(200);
  });
});
