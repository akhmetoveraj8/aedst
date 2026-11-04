import { beforeEach, describe, expect, it, vi } from "vitest";

import { TasksService } from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";
import { reportError } from "@/shared/lib/errors/report-error";
import { fakeJwt } from "@/test/jwt";
import { rpcHandler, TEST_API_ORIGIN } from "@/test/mocks/connect";
import { server } from "@/test/mocks/server";
import { call, jar, LIST, setCookies } from "./route.test-support";

// Request validation and forwarding; the session refresh paths are in
// route.session.test.ts and the shared core in shared/lib/bff/rpc-proxy.test.ts.
vi.mock("@/shared/lib/auth/refresh-session", () => ({
  refreshSession: vi.fn(),
}));

vi.mock("@/shared/lib/errors/report-error", () => ({
  reportError: vi.fn(),
}));

vi.mock(
  "next/headers",
  async () => (await import("./route.test-support")).cookiesMock,
);

beforeEach(() => {
  jar.clear();
});

describe("/api/rpc BFF proxy", () => {
  describe("request validation", () => {
    it("rejects cross-origin callers (CSRF)", async () => {
      const response = await call(LIST, { origin: "https://evil.example" });
      expect(response.status).toBe(403);
    });

    it("does not trust the request's own Host header as proof of origin", async () => {
      const response = await call(LIST, {
        origin: "https://evil.example",
        headers: { host: "evil.example" },
      });
      expect(response.status).toBe(403);
    });

    it("refuses the admin BFF's procedures", async () => {
      jar.set("aedst_session", fakeJwt({ expiresInSeconds: 600 }));
      const response = await call("aedst.admin.v1.AdminService/ListTasks");
      expect(response.status).toBe(404);
    });

    it("rejects requests with no Origin header", async () => {
      expect((await call(LIST, { origin: null })).status).toBe(403);
    });

    it("rejects browser-declared cross-site fetches", async () => {
      const response = await call(LIST, {
        headers: { "sec-fetch-site": "cross-site" },
      });
      expect(response.status).toBe(403);
    });

    it.each([
      "aedst.auth.v1.AuthService/Login",
      "aedst.auth.v1.AuthService/Register",
      "aedst.auth.v1.AuthService/RefreshToken",
      "aedst.auth.v1.AuthService/Logout",
      "aedst.auth.v1.AuthService/GetCurrentUser",
    ])(
      "refuses %s — sign-in is OpenID Connect, not an RPC through this proxy",
      async (procedure) => {
        expect((await call(procedure)).status).toBe(404);
      },
    );

    it.each([
      "evil.v1.Service/Method",
      "aedst.tasks.v1.TasksService/../Admin",
      "aedst.tasks.v1.TasksService",
    ])("refuses unknown procedure %s", async (procedure) => {
      expect((await call(procedure)).status).toBe(404);
    });
  });

  describe("forwarding", () => {
    it("attaches the bearer token from the httpOnly cookie and relays the response", async () => {
      const access = fakeJwt({ expiresInSeconds: 600 });
      jar.set("aedst_session", access);
      let seenAuth: string | null = null;
      server.use(
        rpcHandler(
          TasksService.method.listTasks,
          (_input, request) => {
            seenAuth = request.headers.get("authorization");
            return { tasks: [], totalCount: 5 };
          },
          TEST_API_ORIGIN,
        ),
      );

      const response = await call(LIST);

      expect(response.status).toBe(200);
      expect(seenAuth).toBe(`Bearer ${access}`);
      expect(await response.json()).toMatchObject({ totalCount: 5 });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(setCookies(response)).toEqual([]);
    });

    it("forwards trace headers so browser and server spans join up", async () => {
      jar.set("aedst_session", fakeJwt({ expiresInSeconds: 600 }));
      let seen: Record<string, string | null> = {};
      server.use(
        rpcHandler(
          TasksService.method.listTasks,
          (_input, request) => {
            seen = {
              traceparent: request.headers.get("traceparent"),
              sentryTrace: request.headers.get("sentry-trace"),
              cookie: request.headers.get("cookie"),
            };
            return { tasks: [] };
          },
          TEST_API_ORIGIN,
        ),
      );

      await call(LIST, {
        headers: {
          traceparent: "00-abc-def-01",
          "sentry-trace": "abc-def-1",
          cookie: "aedst_session=secret",
        },
      });

      expect(seen.traceparent).toBe("00-abc-def-01");
      expect(seen.sentryTrace).toBe("abc-def-1");
      // The session cookie itself never goes upstream.
      expect(seen.cookie).toBeNull();
    });

    it("answers 503 when the API is unreachable", async () => {
      jar.set("aedst_session", fakeJwt({ expiresInSeconds: 600 }));
      server.use((routes) => {
        routes.set(`POST ${TEST_API_ORIGIN}/${LIST}`, () => {
          throw new TypeError("fetch failed");
        });
      });

      expect((await call(LIST)).status).toBe(503);
    });

    it("never lets the bearer follow an upstream redirect", async () => {
      jar.set("aedst_session", fakeJwt({ expiresInSeconds: 600 }));
      let redirect: RequestRedirect | undefined;
      server.use((routes) => {
        routes.set(`POST ${TEST_API_ORIGIN}/${LIST}`, (request) => {
          redirect = request.redirect;
          return Response.json({ tasks: [] });
        });
      });

      await call(LIST);

      expect(redirect).toBe("error");
    });

    it("reports an unreachable API to Sentry with the bff source and procedure", async () => {
      jar.set("aedst_session", fakeJwt({ expiresInSeconds: 600 }));
      const failure = new TypeError("fetch failed");
      server.use((routes) => {
        routes.set(`POST ${TEST_API_ORIGIN}/${LIST}`, () => {
          throw failure;
        });
      });

      await call(LIST);

      expect(reportError).toHaveBeenCalledWith(failure, {
        source: "bff",
        procedure: LIST,
      });
    });

    it("applies the timeout only until headers: a stream may outlive it but not go idle", async () => {
      jar.set("aedst_session", fakeJwt({ expiresInSeconds: 600 }));
      const encoder = new TextEncoder();
      server.use((routes) => {
        routes.set(`POST ${TEST_API_ORIGIN}/${LIST}`, () => {
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode("first"));
            },
          });
          return new Response(stream, { status: 200 });
        });
      });
      // Record the guard timers instead of waiting on them.
      const timers: { ms: number; run: () => void }[] = [];
      const realSetTimeout = globalThis.setTimeout;
      const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
        run: () => void,
        ms?: number,
        ...rest: []
      ) => {
        timers.push({ ms: ms ?? 0, run });
        return realSetTimeout(() => undefined, 0, ...rest);
      }) as unknown as typeof setTimeout);
      try {
        const response = await call(LIST);
        expect(response.status).toBe(200);
        // The header timer (15 s) was cleared on arrival; the body is guarded
        // by a separate, longer idle timer.
        const idle = timers.filter((t) => t.ms === 60_000);
        expect(idle.length).toBeGreaterThan(0);
        const reader = response.body?.getReader();
        const first = await reader?.read();
        expect(new TextDecoder().decode(first?.value)).toBe("first");
        const pending = reader?.read();
        for (const timer of timers) {
          timer.run();
        }
        await expect(pending).rejects.toBeDefined();
      } finally {
        spy.mockRestore();
      }
    });
  });
});
