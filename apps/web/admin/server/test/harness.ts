import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";

import type { OidcConfig } from "@/shared/lib/auth/oidc/config";
import {
  ACCESS_COOKIE,
  ID_COOKIE,
  REFRESH_COOKIE,
} from "@/shared/lib/auth/session-cookies";
import { createApp } from "../app";
import { parseEnv, type ServerEnv } from "../env";
import { silentLogger } from "../logger";
import type { AuthDeps } from "../types";

export const ORIGIN = "http://localhost:3001";
export const API = "http://localhost:8080";

export { ACCESS_COOKIE, ID_COOKIE, REFRESH_COOKIE };

/** A Vite-style index.html: the nonce placeholder on every script/style/link. */
export const INDEX_HTML = `<!doctype html><html><head>
<script type="module" nonce="__CSP_NONCE__" src="/assets/index-abc123.js"></script>
<link rel="modulepreload" nonce="__CSP_NONCE__" href="/assets/vendor-def456.js">
<link rel="stylesheet" nonce="__CSP_NONCE__" href="/assets/index-abc123.css">
<style nonce="__CSP_NONCE__">body{margin:0}</style>
</head><body><div id="root"></div></body></html>`;

/** A static dir with index.html (must never be served as a file) and one asset. */
function makeStaticDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "admin-static-"));
  mkdirSync(path.join(dir, "assets"));
  writeFileSync(path.join(dir, "index.html"), INDEX_HTML);
  writeFileSync(path.join(dir, "assets", "index-abc123.js"), "console.log(1)");
  writeFileSync(path.join(dir, "favicon.svg"), "<svg/>");
  return dir;
}

export function makeHarness(
  envOverrides: Record<string, string> = {},
  options: { indexHtml?: () => Promise<string> } = {},
) {
  const env: ServerEnv = parseEnv({
    NODE_ENV: "test",
    ADMIN_ORIGIN: ORIGIN,
    API_BASE_URL: API,
    ...envOverrides,
  });
  const fetchMock = vi.fn<typeof fetch>(
    async () => new Response("{}", { status: 200 }),
  );
  const auth = {
    getOidcConfig: vi.fn<AuthDeps["getOidcConfig"]>(() => ({}) as OidcConfig),
    startLogin: vi.fn<AuthDeps["startLogin"]>(),
    completeLogin: vi.fn<AuthDeps["completeLogin"]>(),
    refreshSession: vi.fn<AuthDeps["refreshSession"]>(),
    revokeRefreshToken: vi.fn<AuthDeps["revokeRefreshToken"]>(async () => {}),
    buildEndSessionUrl: vi.fn<AuthDeps["buildEndSessionUrl"]>(async () => null),
  } satisfies AuthDeps;
  const app = createApp({
    env,
    fetch: fetchMock,
    logger: silentLogger,
    auth,
    staticDir: makeStaticDir(),
    readIndexHtml: options.indexHtml ?? (async () => INDEX_HTML),
  });
  return { app, auth, fetchMock, env };
}

export function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

/** Name=value pairs of every Set-Cookie line, plus the raw lines. */
export function setCookies(response: Response): {
  raw: string[];
  values: Record<string, string>;
} {
  const raw = response.headers.getSetCookie();
  const values: Record<string, string> = {};
  for (const line of raw) {
    const [pair = ""] = line.split(";");
    const index = pair.indexOf("=");
    values[pair.slice(0, index)] = pair.slice(index + 1);
  }
  return { raw, values };
}
