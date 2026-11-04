import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/rpc/[...path]/route";
import { fakeJwt } from "@/test/jwt";
import { TEST_API_ORIGIN } from "@/test/mocks/connect";
import { createFakeIdp, TEST_ISSUER } from "@/test/mocks/oidc";
import { server } from "@/test/mocks/server";
import contract from "../../../../../../docs/contract/behavior/session-refresh.json";

/**
 * Replays docs/contract/behavior/session-refresh.json against the real BFF
 * proxy (`/api/rpc`, the web's 401 -> refresh -> replay logic) and the real
 * `refreshSession` (single flight), with only the IdP and apps/server
 * replaced by scripted fetches.
 */
type RefreshOutcome = "ok" | "invalid_grant" | "transient";
type Case = {
  id: string;
  requests: Array<{ id: string; server: number[] }>;
  refresh: RefreshOutcome[];
  expect: {
    refreshCalls: number;
    results: Record<string, string>;
    session: string;
    replays: Record<string, number>;
  };
};

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name) } : undefined,
  }),
}));

const PROCEDURE = "aedst.tasks.v1.TasksService/ListTasks";

/**
 * Known, documented deviations of the web client from the contract. Each
 * entry is what web actually does; remove it when web matches the contract.
 *  - invalid-grant-signs-out: the first `invalid_grant` for a refresh token
 *    is treated as a probable lost rotation race against another replica
 *    ("stale", see refresh-session.ts): the request fails unauthenticated
 *    and the access cookie is dropped, but the refresh cookie is kept. The
 *    session ends on the next refusal after the race window (asserted below).
 */
const DEVIATIONS: Record<string, { session: string }> = {
  "invalid-grant-signs-out": { session: "signed_in" },
};

function tokenReply(outcome: RefreshOutcome | undefined) {
  if (outcome === "invalid_grant") {
    return { status: 400, body: { error: "invalid_grant" } };
  }
  if (outcome === "transient") {
    return { status: 503, body: { error: "temporarily_unavailable" } };
  }
  return {
    body: {
      access_token: fakeJwt({ expiresInSeconds: 900 }),
      refresh_token: `rotated-${crypto.randomUUID()}`,
      token_type: "Bearer",
      expires_in: 900,
    },
  };
}

function setup(testCase: Case) {
  const outcomes = [...testCase.refresh];
  const idp = createFakeIdp({ onToken: () => tokenReply(outcomes.shift()) });
  const upstreamCalls: Record<string, number> = {};
  const statuses = new Map(
    testCase.requests.map((request) => [request.id, [...request.server]]),
  );

  const stubbed = globalThis.fetch;
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) =>
    new URL(input instanceof Request ? input.url : String(input)).origin ===
    TEST_ISSUER
      ? idp.fetch(input, init)
      : stubbed(input, init),
  );
  server.use((routes) => {
    routes.set(`POST ${TEST_API_ORIGIN}/${PROCEDURE}`, async (request) => {
      const { id } = (await request.json()) as { id: string };
      upstreamCalls[id] = (upstreamCalls[id] ?? 0) + 1;
      const status = statuses.get(id)?.shift();
      if (status === undefined) {
        throw new Error(`unscripted upstream call for ${id}`);
      }
      return status === 200
        ? Response.json({ tasks: [] })
        : Response.json({ code: "unauthenticated", message: "x" }, { status });
    });
  });
  return { idp, upstreamCalls };
}

function send(id: string) {
  return POST(
    new Request(`http://localhost:3000/api/rpc/${PROCEDURE}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "localhost:3000",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({ id }),
    }),
    { params: Promise.resolve({ path: PROCEDURE.split("/") }) },
  );
}

const RESULT_BY_STATUS: Record<number, string> = {
  200: "ok",
  401: "unauthenticated",
  503: "retryable_error",
};

/** The session ends only when the refresh cookie is cleared. */
function sessionAfter(responses: Response[]) {
  const cleared = responses.some((response) =>
    response.headers
      .getSetCookie()
      .some((cookie) => /^aedst_session_refresh=;.*Max-Age=0/i.test(cookie)),
  );
  return cleared ? "signed_out" : "signed_in";
}

beforeEach(() => {
  jar.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("session-refresh contract", () => {
  it.each(contract.cases as Case[])("$id", async (testCase) => {
    jar.set("aedst_session", fakeJwt({ expiresInSeconds: 600 }));
    jar.set("aedst_session_refresh", `rt-${testCase.id}`);
    const { idp, upstreamCalls } = setup(testCase);

    const responses = await Promise.all(
      testCase.requests.map((request) => send(request.id)),
    );

    expect(idp.tokenCalls).toHaveLength(testCase.expect.refreshCalls);
    testCase.requests.forEach((request, index) => {
      expect(RESULT_BY_STATUS[responses[index]?.status ?? 0]).toBe(
        testCase.expect.results[request.id],
      );
      expect(Math.max((upstreamCalls[request.id] ?? 0) - 1, 0)).toBe(
        testCase.expect.replays[request.id],
      );
    });
    expect(sessionAfter(responses)).toBe(
      DEVIATIONS[testCase.id]?.session ?? testCase.expect.session,
    );
  });

  it("invalid_grant ends the session once the race window has passed (the documented deviation)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const testCase = (contract.cases as Case[]).find(
      (candidate) => candidate.id === "invalid-grant-signs-out",
    ) as Case;
    jar.set("aedst_session", fakeJwt({ expiresInSeconds: 600 }));
    jar.set("aedst_session_refresh", "rt-invalid-grant-window");
    const { idp } = setup({
      ...testCase,
      requests: [
        { id: "r1", server: [401] },
        { id: "r2", server: [401] },
      ],
      refresh: ["invalid_grant", "invalid_grant"],
    });

    const first = await send("r1");
    expect(sessionAfter([first])).toBe("signed_in");

    await vi.advanceTimersByTimeAsync(16_000);
    const second = await send("r2");

    expect(idp.tokenCalls).toHaveLength(2);
    expect(second.status).toBe(401);
    expect(sessionAfter([second])).toBe("signed_out");
  });
});
