import { beforeEach, describe, expect, it, vi } from "vitest";

import { TasksService } from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";
import { refreshSession } from "@/shared/lib/auth/refresh-session";
import { fakeJwt } from "@/test/jwt";
import {
  rpcErrorHandler,
  rpcHandler,
  TEST_API_ORIGIN,
} from "@/test/mocks/connect";
import { server } from "@/test/mocks/server";
import { call, jar, LIST, setCookies } from "./route.test-support";

// The refresh grant itself is covered by refresh-session.test.ts; here only
// what the proxy does with each outcome matters.
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

    it("keeps the rotated tokens when apps/server is down right after the refresh", async () => {
      jar.set("aedst_session", fakeJwt({ expiresInSeconds: -60 }));
      jar.set("aedst_session_refresh", "rt-before-outage");
      rotate("outage");
      server.use((routes) => {
        routes.set(`POST ${TEST_API_ORIGIN}/${LIST}`, () => {
          throw new TypeError("fetch failed");
        });
      });

      const response = await call(LIST);

      expect(response.status).toBe(503);
      // The old refresh token is dead at the IdP: losing the new pair would
      // turn a transient outage into a sign-out.
      expect(
        setCookies(response).some((c) =>
          c.startsWith("aedst_session_refresh=outage-refresh"),
        ),
      ).toBe(true);
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
