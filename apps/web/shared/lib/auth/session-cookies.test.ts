import { afterEach, describe, expect, it, vi } from "vitest";

import { CONSENT_COOKIE } from "@/shared/lib/consent/consent-cookie";
import { SIDEBAR_COOKIE_NAME } from "@/shared/ui/sidebar/constants";
import { PRE_AUTH_COOKIE } from "./oidc/pre-auth-cookie";
import {
  ACCESS_COOKIE,
  type CookieWriter,
  clearSessionCookies,
  ID_COOKIE,
  MAX_COOKIE_CHUNKS,
  REFRESH_COOKIE,
  readSessionCookie,
  sessionCookieNames,
  writeSessionCookies,
} from "./session-cookies";
import {
  byteLength,
  MAX_COOKIE_BYTES,
  MAX_COOKIES_PER_DOMAIN,
  realisticMaxTokens,
  serializeSetCookie,
} from "./session-cookies.test-support";

/** A browser's view: the last `Set-Cookie` per name; Max-Age=0 removes it. */
function recordingJar() {
  const lines = new Map<string, string>();
  const live = new Map<string, string>();
  const jar: CookieWriter = {
    set(name, value, options) {
      lines.set(name, serializeSetCookie(name, value, options));
      if (options?.maxAge === 0) {
        live.delete(name);
      } else {
        live.set(name, value);
      }
    },
  };
  return { jar, lines, live, read: (name: string) => live.get(name) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("session cookie budget", () => {
  it("keeps every session cookie under 4096 bytes with realistic maximum tokens", () => {
    const { jar, lines, live } = recordingJar();
    expect(writeSessionCookies(jar, realisticMaxTokens())).toBe(true);

    // Realistic tokens need no chunks: one cookie per value.
    expect([...live.keys()]).toEqual([
      ACCESS_COOKIE,
      REFRESH_COOKIE,
      ID_COOKIE,
    ]);
    const sizes = [...live.keys()].map((name) =>
      byteLength(lines.get(name) ?? ""),
    );
    for (const size of sizes) {
      expect(size).toBeLessThan(MAX_COOKIE_BYTES);
    }
    // The fixture is a real worst case, not a token that fits trivially.
    expect(Math.max(...sizes)).toBeGreaterThan(MAX_COOKIE_BYTES / 2);
  });

  it("splits a token that does not fit one cookie and reads it back whole", () => {
    const tokens = realisticMaxTokens(24);
    const { jar, lines, live, read } = recordingJar();
    expect(writeSessionCookies(jar, tokens)).toBe(true);

    expect(live.has(ACCESS_COOKIE)).toBe(false);
    expect(live.has(`${ACCESS_COOKIE}.0`)).toBe(true);
    expect(live.has(`${ACCESS_COOKIE}.1`)).toBe(true);
    for (const name of live.keys()) {
      const line = lines.get(name) ?? "";
      expect(byteLength(line)).toBeLessThan(MAX_COOKIE_BYTES);
      // Every chunk carries the session attributes.
      expect(line).toContain("HttpOnly");
      expect(line).toContain("SameSite=lax");
      expect(line).toContain("Path=/");
    }
    expect(readSessionCookie(read, ACCESS_COOKIE)).toBe(tokens.accessToken);
    expect(readSessionCookie(read, REFRESH_COOKIE)).toBe(tokens.refreshToken);
    expect(readSessionCookie(read, ID_COOKIE)).toBe(tokens.idToken);
  });

  it("clears the stale chunks when a smaller value replaces a larger one", () => {
    const { jar, lines, live, read } = recordingJar();
    writeSessionCookies(jar, realisticMaxTokens(24), read);
    const small = realisticMaxTokens(2);
    writeSessionCookies(jar, small, read);

    expect([...live.keys()].sort()).toEqual(
      [ACCESS_COOKIE, REFRESH_COOKIE, ID_COOKIE].sort(),
    );
    expect(lines.get(`${ACCESS_COOKIE}.0`)).toContain("Max-Age=0");
    expect(lines.get(`${ACCESS_COOKIE}.1`)).toContain("Max-Age=0");
    expect(readSessionCookie(read, ACCESS_COOKIE)).toBe(small.accessToken);
  });

  it("clears the whole cookie when a larger value replaces a smaller one", () => {
    const { jar, lines, read } = recordingJar();
    writeSessionCookies(jar, realisticMaxTokens(2), read);
    const large = realisticMaxTokens(24);
    writeSessionCookies(jar, large, read);

    expect(lines.get(ACCESS_COOKIE)).toContain("Max-Age=0");
    expect(readSessionCookie(read, ACCESS_COOKIE)).toBe(large.accessToken);
  });

  it("fails closed, with a log that carries no token, past the caps", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const tokens = realisticMaxTokens(80);
    const { jar, live } = recordingJar();
    writeSessionCookies(jar, realisticMaxTokens());

    expect(writeSessionCookies(jar, tokens)).toBe(false);

    // Nothing of the old or the new session is left.
    expect(live.size).toBe(0);
    expect(log).toHaveBeenCalledOnce();
    const logged = JSON.stringify(log.mock.calls[0]);
    expect(logged).toContain("auth.session_cookie_too_large");
    expect(logged).not.toContain(tokens.accessToken.slice(0, 40));
    expect(logged).not.toContain(tokens.refreshToken.slice(0, 40));
  });

  it("clearing the session expires every name a value can occupy", () => {
    const { jar, live, lines } = recordingJar();
    writeSessionCookies(jar, realisticMaxTokens(24));
    clearSessionCookies(jar);

    expect(live.size).toBe(0);
    for (const cookie of [ACCESS_COOKIE, REFRESH_COOKIE, ID_COOKIE]) {
      for (const name of sessionCookieNames(cookie)) {
        expect(lines.get(name)).toContain("Max-Age=0");
      }
    }
  });

  it("sets fewer than 20 cookies on the domain even when every value is chunked", () => {
    // The session at its cap (three values in MAX_COOKIE_CHUNKS cookies each),
    // the sealed pre-auth state (login round trip only), consent, the sidebar
    // state and next-intl's locale.
    const worstCase = 3 * MAX_COOKIE_CHUNKS;
    const others = new Set([
      PRE_AUTH_COOKIE,
      CONSENT_COOKIE,
      SIDEBAR_COOKIE_NAME,
      "NEXT_LOCALE",
    ]);
    expect(worstCase + others.size).toBe(13);
    expect(worstCase + others.size).toBeLessThan(MAX_COOKIES_PER_DOMAIN);
  });
});
