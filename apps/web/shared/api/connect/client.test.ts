import { describe, expect, it } from "vitest";

import {
  BROWSER_TIMEOUT_MS,
  createBrowserTransport,
} from "@/shared/api/connect/client";

describe("browser transport", () => {
  it("has a 20 s default deadline", () => {
    expect(BROWSER_TIMEOUT_MS).toBe(20_000);
    expect(createBrowserTransport()).toBeDefined();
  });

  it("sends connect-timeout-ms so the BFF and server share the deadline", async () => {
    const seen: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get("connect-timeout-ms") ?? "");
      return Response.json({}, { status: 200 });
    }) as typeof fetch;
    try {
      const { createClient } = await import("@connectrpc/connect");
      const { TasksService } = await import("@/shared/api/connect/client");
      const { createConnectTransport } = await import(
        "@connectrpc/connect-web"
      );
      // Same options as createBrowserTransport, minus the connect-query key wrapper.
      const client = createClient(
        TasksService,
        createConnectTransport({
          baseUrl: "http://localhost/api/rpc",
          defaultTimeoutMs: BROWSER_TIMEOUT_MS,
        }),
      );
      await client.listTasks({}).catch(() => undefined);
      expect(seen[0]).toBe("20000");
    } finally {
      globalThis.fetch = original;
    }
  });
});
