import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PRE_AUTH_COOKIE } from "@/shared/lib/auth/oidc/pre-auth-cookie";
import {
  MAX_COOKIE_CHUNKS,
  type SessionTokens,
  writeSessionCookies,
} from "@/shared/lib/auth/session-cookies";
import {
  byteLength,
  MAX_COOKIE_BYTES,
  MAX_COOKIES_PER_DOMAIN,
  realisticMaxTokens,
} from "@/shared/lib/auth/session-cookies.test-support";
import { cookieJar, readCookie, requestCookies } from "./session";
import { ACCESS_COOKIE, ID_COOKIE, REFRESH_COOKIE } from "./test/harness";
import type { AppBindings } from "./types";

/**
 * The BFF's real cookie path: `/write` stores tokens through the Hono cookie
 * adapter, `/read` returns what the session code reads back from a request.
 */
function makeApp(tokens: SessionTokens) {
  const app = new Hono<AppBindings>();
  app.get("/write", (c) =>
    c.json({
      stored: writeSessionCookies(cookieJar(c), tokens, requestCookies(c)),
    }),
  );
  app.get("/read", (c) =>
    c.json({
      access: readCookie(c, ACCESS_COOKIE) ?? null,
      refresh: readCookie(c, REFRESH_COOKIE) ?? null,
      id: readCookie(c, ID_COOKIE) ?? null,
    }),
  );
  return app;
}

const cookieName = (line: string) => line.slice(0, line.indexOf("="));
const isExpired = (line: string) => /max-age=0/i.test(line);

/** The `Cookie` header a browser would send back after these `Set-Cookie` lines. */
function cookieHeaderFrom(lines: string[]): string {
  return lines
    .filter((line) => !isExpired(line))
    .map((line) => line.split(";")[0])
    .join("; ");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("admin session cookie budget", () => {
  it("keeps every session cookie under 4096 bytes with realistic maximum tokens", async () => {
    const response = await makeApp(realisticMaxTokens()).request("/write");
    const lines = response.headers.getSetCookie();
    const live = lines.filter((line) => !isExpired(line));

    expect(live.map(cookieName)).toEqual([
      ACCESS_COOKIE,
      REFRESH_COOKIE,
      ID_COOKIE,
    ]);
    const sizes = live.map(byteLength);
    for (const size of sizes) {
      expect(size).toBeLessThan(MAX_COOKIE_BYTES);
    }
    // The fixture is a real worst case, not a token that fits trivially.
    expect(Math.max(...sizes)).toBeGreaterThan(MAX_COOKIE_BYTES / 2);
  });

  it("splits an oversized token across numbered cookies and reads it back", async () => {
    const tokens = realisticMaxTokens(24);
    const app = makeApp(tokens);
    // The browser holds a small, whole session from before.
    const before = (
      await makeApp(realisticMaxTokens(2)).request("/write")
    ).headers.getSetCookie();
    const lines = (
      await app.request("/write", {
        headers: { cookie: cookieHeaderFrom(before) },
      })
    ).headers.getSetCookie();
    const live = lines.filter((line) => !isExpired(line));

    expect(live.map(cookieName)).toContain(`${ACCESS_COOKIE}.0`);
    expect(live.map(cookieName)).toContain(`${ACCESS_COOKIE}.1`);
    for (const line of live) {
      expect(byteLength(line)).toBeLessThan(MAX_COOKIE_BYTES);
      expect(line).toMatch(/httponly/i);
      expect(line).toMatch(/samesite=lax/i);
      expect(line).toMatch(/path=\//i);
    }
    // The whole-cookie name is expired so a stale smaller token cannot win.
    expect(
      lines.some(
        (line) => cookieName(line) === ACCESS_COOKIE && isExpired(line),
      ),
    ).toBe(true);

    const read = await app.request("/read", {
      headers: { cookie: cookieHeaderFrom(lines) },
    });
    expect(await read.json()).toEqual({
      access: tokens.accessToken,
      refresh: tokens.refreshToken,
      id: tokens.idToken,
    });
  });

  it("expires the stale chunks when a smaller token replaces a larger one", async () => {
    const large = (
      await makeApp(realisticMaxTokens(24)).request("/write")
    ).headers.getSetCookie();
    // The browser now holds the chunked session and gets a small one back.
    const lines = (
      await makeApp(realisticMaxTokens(2)).request("/write", {
        headers: { cookie: cookieHeaderFrom(large) },
      })
    ).headers.getSetCookie();

    for (const index of [0, 1]) {
      const chunk = lines.find(
        (line) => cookieName(line) === `${ACCESS_COOKIE}.${index}`,
      );
      expect(chunk && isExpired(chunk)).toBe(true);
    }
    // A chunk slot the browser never held is not touched.
    expect(
      lines.some(
        (line) =>
          cookieName(line) === `${ACCESS_COOKIE}.${MAX_COOKIE_CHUNKS - 1}`,
      ),
    ).toBe(false);
  });

  it("fails closed past the caps and logs no token content", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const tokens = realisticMaxTokens(80);
    const held = (
      await makeApp(realisticMaxTokens()).request("/write")
    ).headers.getSetCookie();
    const response = await makeApp(tokens).request("/write", {
      headers: { cookie: cookieHeaderFrom(held) },
    });

    expect(await response.json()).toEqual({ stored: false });
    const lines = response.headers.getSetCookie();
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every(isExpired)).toBe(true);
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain("auth.session_cookie_too_large");
    expect(logged).not.toContain(tokens.accessToken.slice(0, 40));
  });

  it("sets fewer than 20 cookies on the admin domain even when every value is chunked", () => {
    // The session at its cap plus the sealed pre-auth state of the login
    // round trip and the kit's sidebar state.
    const others = new Set([PRE_AUTH_COOKIE, "sidebar_state"]);
    expect(3 * MAX_COOKIE_CHUNKS + others.size).toBeLessThan(
      MAX_COOKIES_PER_DOMAIN,
    );
  });
});
