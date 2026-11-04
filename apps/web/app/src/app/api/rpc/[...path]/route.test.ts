import { beforeEach, describe, expect, it, vi } from "vitest";

import { TasksService } from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";
import { refreshSession } from "@/shared/lib/auth/refresh-session";
import { reportError } from "@/shared/lib/errors/report-error";
import { fakeJwt } from "@/test/jwt";
import {
  rpcErrorHandler,
  rpcHandler,
  TEST_API_ORIGIN,
} from "@/test/mocks/connect";
import { server } from "@/test/mocks/server";
import { POST } from "./route";

// The refresh grant itself is covered by refresh-session.test.ts; here only
// what the proxy does with each outcome matters.
vi.mock("@/shared/lib/auth/refresh-session", () => ({
  refreshSession: vi.fn(),
}));

vi.mock("@/shared/lib/errors/report-error", () => ({
  reportError: vi.fn(),
}));

const jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name) } : undefined,
  }),
}));

const LIST = "aedst.tasks.v1.TasksService/ListTasks";

function call(
  procedure: string,
  init: { origin?: string | null; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "connect-protocol-version": "1", // the browser transport always sends it
    host: "localhost:3000",
    ...init.headers,
  };
  if (init.origin !== null) {
    headers.origin = init.origin ?? "http://localhost:3000";
  }
  return POST(
    new Request(`http://localhost:3000/api/rpc/${procedure}`, {
      method: "POST",
      headers,
      body: "{}",
    }),
    { params: Promise.resolve({ path: procedure.split("/") }) },
  );
}

function setCookies(response: Response): string[] {
  return response.headers.getSetCookie();
}

beforeEach(() => {
  jar.clear();
});

describe("/api/rpc BFF proxy", () => {
  describe("request validation", () => {
    it("rejects cross-origin callers (CSRF)", async () => {
      const response = await call(LIST, { origin: "https://evil.example" });
      expect(response.status).toBe(403);
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

  describe("session refresh", () => {
    const rotate = (label: string) =>
      vi.mocked(refreshSession).mockResolvedValue({
        status: "ok",
        tokens: {
          accessToken: fakeJwt({ sub: label, expiresInSeconds: 900 }),
          refreshToken: `${label}-refresh`,
          accessMaxAgeSeconds: 900,
          refreshMaxAgeSeconds: 86_400,
        },
      });

    it("refreshes an expired access token before calling, and sets the new cookies", async () => {
      jar.set("aedst_session", fakeJwt({ expiresInSeconds: -60 }));
      jar.set("aedst_session_refresh", "rt-expired-access");
      let seenAuth: string | null = null;
      rotate("proactive");
      server.use(
        rpcHandler(
          TasksService.method.listTasks,
          (_input, request) => {
            seenAuth = request.headers.get("authorization");
            return { tasks: [] };
          },
          TEST_API_ORIGIN,
        ),
      );

      const response = await call(LIST);

      expect(response.status).toBe(200);
      expect(seenAuth).toMatch(/^Bearer .+\..+\..+$/);
      const cookies = setCookies(response);
      expect(cookies.some((c) => c.startsWith("aedst_session="))).toBe(true);
      expect(
        cookies.some((c) =>
          c.startsWith("aedst_session_refresh=proactive-refresh"),
        ),
      ).toBe(true);
      for (const cookie of cookies) {
        expect(cookie).toContain("HttpOnly");
        expect(cookie).toContain("SameSite=lax");
      }
    });

    it("retries once with a fresh token when the API answers 401", async () => {
      jar.set("aedst_session", fakeJwt({ expiresInSeconds: 600 }));
      jar.set("aedst_session_refresh", "rt-server-side-revoked-access");
      const seenAuth: Array<string | null> = [];
      // First call: 401. Second (after refresh): success.
      let attempts = 0;
      rotate("retry");
      server.use((routes) => {
        routes.set(`POST ${TEST_API_ORIGIN}/${LIST}`, (request) => {
          attempts += 1;
          seenAuth.push(request.headers.get("authorization"));
          return attempts === 1
            ? Response.json(
                { code: "unauthenticated", message: "expired" },
                { status: 401 },
              )
            : Response.json({ tasks: [] });
        });
      });

      const response = await call(LIST);

      expect(response.status).toBe(200);
      expect(attempts).toBe(2);
      expect(seenAuth[0]).not.toBe(seenAuth[1]);
      expect(setCookies(response).length).toBe(2);
    });

    it("ends the session (401 + cleared cookies) when the refresh token is rejected", async () => {
      jar.set("aedst_session", fakeJwt({ expiresInSeconds: -60 }));
      jar.set("aedst_session_refresh", "rt-rejected-by-server");
      vi.mocked(refreshSession).mockResolvedValue({ status: "rejected" });
      server.use(
        rpcErrorHandler(
          TasksService.method.listTasks,
          "unauthenticated",
          "no token",
          TEST_API_ORIGIN,
        ),
      );

      const response = await call(LIST);

      expect(response.status).toBe(401);
      const cleared = setCookies(response);
      expect(cleared.length).toBe(3);
      for (const cookie of cleared) {
        expect(cookie).toMatch(/Max-Age=0/i);
      }
    });

    it("answers 401 and drops only the access cookie when the token was probably rotated by another replica", async () => {
      jar.set("aedst_session", fakeJwt({ expiresInSeconds: -60 }));
      jar.set("aedst_session_refresh", "rt-lost-rotation-race");
      vi.mocked(refreshSession).mockResolvedValue({ status: "stale" });
      server.use(
        rpcErrorHandler(
          TasksService.method.listTasks,
          "unauthenticated",
          "no token",
          TEST_API_ORIGIN,
        ),
      );

      const response = await call(LIST);

      expect(response.status).toBe(401);
      const cleared = setCookies(response);
      expect(cleared).toHaveLength(1);
      expect(cleared[0]).toMatch(/^aedst_session=;.*Max-Age=0/i);
    });

    it("does not sign the user out when the refresh service is merely down", async () => {
      jar.set("aedst_session", fakeJwt({ expiresInSeconds: -60 }));
      jar.set("aedst_session_refresh", "rt-during-outage");
      vi.mocked(refreshSession).mockResolvedValue({ status: "unavailable" });
      server.use(
        rpcErrorHandler(
          TasksService.method.listTasks,
          "unauthenticated",
          "no token",
          TEST_API_ORIGIN,
        ),
      );

      const response = await call(LIST);

      // A retryable error, not a 401 (which the client treats as sign-out).
      expect(response.status).toBe(503);
      expect(setCookies(response)).toEqual([]);
    });

    it("identifies itself to the server as web/<semver>, ignoring what the page sent", async () => {
      jar.set("aedst_session", fakeJwt({ expiresInSeconds: 600 }));
      let seen: string | null = null;
      server.use(
        rpcHandler(
          TasksService.method.listTasks,
          (_input, request) => {
            seen = request.headers.get("x-aedst-client");
            return { tasks: [] };
          },
          TEST_API_ORIGIN,
        ),
      );

      await call(LIST, { headers: { "x-aedst-client": "android/9.9.9" } });

      expect(seen).toMatch(/^web\/\d+\.\d+\.\d+/);
    });
  });
});
