import { describe, expect, it } from "vitest";

import { CLIENT_HEADER } from "@/shared/api/connect/client-id";
import {
  ACCESS_COOKIE,
  API,
  cookieHeader,
  makeHarness,
  ORIGIN,
  REFRESH_COOKIE,
  setCookies,
} from "../test/harness";
import { tokenWithRoles } from "../test/jwt";

const LIST = "aedst.admin.v1.AdminService/ListTasks";

type Harness = ReturnType<typeof makeHarness>;

function call(
  { app }: Harness,
  procedure: string,
  init: {
    origin?: string | null;
    headers?: Record<string, string>;
    cookies?: Record<string, string>;
    body?: string;
  } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "connect-protocol-version": "1",
    ...init.headers,
  };
  if (init.origin !== null) {
    headers["origin"] = init.origin ?? ORIGIN;
  }
  if (init.cookies) {
    headers["cookie"] = cookieHeader(init.cookies);
  }
  return app.request(`/api/rpc/${procedure}`, {
    method: "POST",
    headers,
    body: init.body ?? "{}",
  });
}

const fresh = () => tokenWithRoles(["admin"], 600);

describe("/api/rpc request validation", () => {
  it("rejects cross-origin callers (CSRF)", async () => {
    const h = makeHarness();
    expect(
      (await call(h, LIST, { origin: "https://evil.example" })).status,
    ).toBe(403);
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it("does not trust the request's own Host header as proof of origin", async () => {
    const h = makeHarness();
    const response = await call(h, LIST, {
      origin: "https://evil.example",
      headers: { host: "evil.example" },
    });
    expect(response.status).toBe(403);
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it("never lets the bearer follow an upstream redirect", async () => {
    const h = makeHarness();
    await call(h, LIST, { cookies: { [ACCESS_COOKIE]: fresh() } });
    expect(h.fetchMock.mock.calls[0]?.[1]?.redirect).toBe("error");
  });

  it("rejects requests with no Origin header", async () => {
    expect((await call(makeHarness(), LIST, { origin: null })).status).toBe(
      403,
    );
  });

  it("rejects browser-declared cross-site and same-site fetches", async () => {
    for (const site of ["cross-site", "same-site"]) {
      const response = await call(makeHarness(), LIST, {
        headers: { "sec-fetch-site": site },
      });
      expect(response.status).toBe(403);
    }
  });

  it("answers only the admin allowlist of services", async () => {
    const h = makeHarness();
    for (const procedure of [
      "aedst.tasks.v1.TasksService/ListTasks",
      "aedst.auth.v1.AuthService/Login",
      "aedst.admin.v1.AdminService/ListTasks/extra",
      "..%2F..%2Fadmin",
    ]) {
      const response = await call(h, procedure, {
        cookies: { [ACCESS_COOKIE]: fresh() },
      });
      expect(response.status).toBe(404);
    }
    expect(h.fetchMock).not.toHaveBeenCalled();
    const ok = await call(h, "aedst.capabilities.v1.CapabilitiesService/Get", {
      cookies: { [ACCESS_COOKIE]: fresh() },
    });
    expect(ok.status).toBe(200);
  });

  it("caps the body (declared and streamed) with 413 before forwarding", async () => {
    const h = makeHarness();
    const big = "x".repeat(1_000_001);
    const response = await call(h, LIST, { body: big });
    expect(response.status).toBe(413);
    expect(h.fetchMock).not.toHaveBeenCalled();
  });
});

describe("/api/rpc forwarding", () => {
  it("attaches the bearer token, identifies the client and relays the response uncached", async () => {
    const h = makeHarness();
    const access = fresh();
    h.fetchMock.mockResolvedValue(
      new Response('{"tasks":[]}', {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie": "leak=1",
          "x-upstream": "yes",
        },
      }),
    );
    const response = await call(h, LIST, {
      cookies: { [ACCESS_COOKIE]: access },
      headers: {
        cookie: "ignored-by-spread",
        "x-evil": "1",
        [CLIENT_HEADER]: "spoofed/9.9.9",
        authorization: "Bearer from-page",
        traceparent: "00-aaaa-bbbb-01",
      },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"tasks":[]}');
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-upstream")).toBe("yes");
    expect(response.headers.get("set-cookie")).toBeNull();

    const [url, init] = h.fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`${API}/${LIST}`);
    const sent = new Headers(init?.headers);
    expect(sent.get("authorization")).toBe(`Bearer ${access}`);
    expect(sent.get(CLIENT_HEADER)).toMatch(/^web\/\d+\.\d+\.\d+/);
    expect(sent.get("traceparent")).toBe("00-aaaa-bbbb-01");
    expect(sent.get("x-evil")).toBeNull();
    expect(sent.get("cookie")).toBeNull();
    expect(init?.method).toBe("POST");
  });

  it("answers 503 when the API is unreachable", async () => {
    const h = makeHarness();
    h.fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const response = await call(h, LIST, {
      cookies: { [ACCESS_COOKIE]: fresh() },
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "unavailable" });
  });

  it("passes a streamed upstream body through chunk by chunk", async () => {
    const h = makeHarness();
    const encoder = new TextEncoder();
    h.fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode("one,"));
            controller.enqueue(encoder.encode("two"));
            controller.close();
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/connect+json" },
        },
      ),
    );
    const response = await call(h, LIST, {
      cookies: { [ACCESS_COOKIE]: fresh() },
    });
    expect(await response.text()).toBe("one,two");
    expect(response.headers.get("content-type")).toBe(
      "application/connect+json",
    );
  });
});

describe("/api/rpc session refresh", () => {
  const stale = () => ({
    [ACCESS_COOKIE]: tokenWithRoles(["admin"], -60),
    [REFRESH_COOKIE]: "old-refresh",
  });
  const tokens = () => ({
    accessToken: fresh(),
    refreshToken: "new-refresh",
    accessMaxAgeSeconds: 600,
    refreshMaxAgeSeconds: 3600,
  });

  it("refreshes an expired access token first and sets the new cookies", async () => {
    const h = makeHarness();
    const next = tokens();
    h.auth.refreshSession.mockResolvedValue({ status: "ok", tokens: next });
    const response = await call(h, LIST, { cookies: stale() });
    expect(response.status).toBe(200);
    expect(h.auth.refreshSession).toHaveBeenCalledTimes(1);
    const sent = new Headers(h.fetchMock.mock.calls[0]?.[1]?.headers);
    expect(sent.get("authorization")).toBe(`Bearer ${next.accessToken}`);
    const { values } = setCookies(response);
    expect(values[ACCESS_COOKIE]).toBe(next.accessToken);
    expect(values[REFRESH_COOKIE]).toBe("new-refresh");
  });

  it("keeps the rotated tokens when apps/server is down right after the refresh", async () => {
    const h = makeHarness();
    const next = tokens();
    h.auth.refreshSession.mockResolvedValue({ status: "ok", tokens: next });
    h.fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const response = await call(h, LIST, { cookies: stale() });
    expect(response.status).toBe(503);
    // The old refresh token is dead at the IdP: losing the new pair would turn
    // a transient outage into a sign-out.
    const { values } = setCookies(response);
    expect(values[ACCESS_COOKIE]).toBe(next.accessToken);
    expect(values[REFRESH_COOKIE]).toBe("new-refresh");
  });

  it("retries once with a fresh token when the API answers 401", async () => {
    const h = makeHarness();
    const next = tokens();
    h.auth.refreshSession.mockResolvedValue({ status: "ok", tokens: next });
    h.fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    const response = await call(h, LIST, {
      cookies: { [ACCESS_COOKIE]: fresh(), [REFRESH_COOKIE]: "old-refresh" },
    });
    expect(response.status).toBe(200);
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
    expect(h.auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(setCookies(response).values[REFRESH_COOKIE]).toBe("new-refresh");
  });

  it("never refreshes twice in one request", async () => {
    const h = makeHarness();
    h.auth.refreshSession.mockResolvedValue({ status: "rejected" });
    h.fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
    await call(h, LIST, { cookies: stale() });
    expect(h.auth.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("ends the session (401 + cleared cookies) when the refresh token is rejected", async () => {
    const h = makeHarness();
    h.auth.refreshSession.mockResolvedValue({ status: "rejected" });
    h.fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
    const response = await call(h, LIST, { cookies: stale() });
    expect(response.status).toBe(401);
    expect(
      setCookies(response).raw.filter((l) => /Max-Age=0/i.test(l)),
    ).toHaveLength(3);
  });

  it("drops only the access cookie when the token was probably rotated elsewhere", async () => {
    const h = makeHarness();
    h.auth.refreshSession.mockResolvedValue({ status: "stale" });
    h.fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
    const response = await call(h, LIST, { cookies: stale() });
    expect(response.status).toBe(401);
    const { raw, values } = setCookies(response);
    expect(raw).toHaveLength(1);
    expect(values[ACCESS_COOKIE]).toBe("");
  });

  it("does not sign the user out when the refresh service is merely down", async () => {
    const h = makeHarness();
    h.auth.refreshSession.mockResolvedValue({ status: "unavailable" });
    h.fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
    const response = await call(h, LIST, { cookies: stale() });
    expect(response.status).toBe(503);
    expect(setCookies(response).raw).toEqual([]);
  });
});
