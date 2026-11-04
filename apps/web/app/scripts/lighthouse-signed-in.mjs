#!/usr/bin/env node
// Lighthouse for the signed-in pages (/en/tasks, /en/tasks/new) - the pages
// users actually live in, which lighthouserc.json (public pages only) cannot reach.
//
// How: start the e2e mock API (it doubles as the OpenID Connect provider, see
// e2e/mock-api) and the production server, sign a seeded user in through the
// real redirect flow with Playwright (already a dev dependency), then run
// Lighthouse CI with the session cookies as a request header. Lighthouse
// resets storage between runs, so a header is the reliable way to stay signed
// in; no puppeteer or `lighthouse` dependency is added (lhci runs via dlx).
//
// Needs a production build (`pnpm build`) and Playwright Chromium. Run:
//   pnpm lighthouse:signed-in
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
const API_PORT = 8181;
const web = `http://127.0.0.1:${WEB_PORT}`;
const api = `http://127.0.0.1:${API_PORT}`;
const outDir = join(root, ".lighthouseci-signed-in");

const children = [];
function start(command, args, env) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  children.push(child);
  return child;
}

async function waitFor(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) {
        return;
      }
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`timed out waiting for ${url}`);
}

async function signedInCookieHeader() {
  const email = `lh-${Date.now()}@example.com`;
  const seeded = await fetch(`${api}/__test/seed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, tasks: 25 }),
  }).then((response) => response.json());

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    // Declined consent keeps the banner out of the audited layout.
    await context.addCookies([
      { name: "aedst_consent", value: "denied", url: web },
    ]);
    const page = await context.newPage();
    await page.goto(`${web}/en`);
    await page.getByRole("link", { name: "Sign in", exact: true }).click();
    await page.getByLabel("IdP email").fill(seeded.email);
    await page.getByLabel("IdP password").fill(seeded.password);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(/\/en\/tasks/);
    const cookies = await context.cookies(web);
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  } finally {
    await browser.close();
  }
}

function writeConfig(cookie) {
  const base = JSON.parse(
    readFileSync(join(root, "lighthouserc.json"), "utf8"),
  ).ci;
  const config = {
    ci: {
      collect: {
        url: [`${web}/en/tasks`, `${web}/en/tasks/new`],
        numberOfRuns: 2,
        settings: {
          ...base.collect.settings,
          extraHeaders: { Cookie: cookie },
        },
      },
      assert: {
        assertions: {
          // Same bar as the public pages for a11y/best practices/layout;
          // performance is a warning until real numbers exist for these pages.
          "categories:accessibility": ["error", { minScore: 1 }],
          "categories:best-practices": ["error", { minScore: 0.95 }],
          "categories:performance": ["warn", { minScore: 0.8 }],
          "cumulative-layout-shift": ["error", { maxNumericValue: 0.1 }],
          "total-blocking-time": ["warn", { maxNumericValue: 300 }],
          "uses-http2": "off",
          "csp-xss": "warn",
        },
      },
      upload: { target: "filesystem", outputDir: outDir },
    },
  };
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, "lighthouserc.signed-in.json");
  writeFileSync(file, JSON.stringify(config, null, 2));
  return file;
}

let exitCode = 1;
try {
  start("node", ["e2e/mock-api/server.mjs"], {
    MOCK_API_PORT: String(API_PORT),
  });
  start("pnpm", ["start", "--port", String(WEB_PORT)], {
    API_BASE_URL: api,
    OIDC_ISSUER: `${api}/oidc`,
    OIDC_CLIENT_ID: "aedst-web-e2e",
    OIDC_PROJECT_ID: "aedst-api-e2e",
    OIDC_STATE_SECRET: "e2e-only-state-secret-e2e-only-state-secret",
    AUTH_ROLES_CLAIM: "urn:zitadel:iam:org:project:roles",
    NEXT_PUBLIC_SITE_URL: web,
    MEDIA_ORIGINS: api,
  });
  await Promise.all([
    waitFor(`${api}/__test/health`),
    waitFor(`${web}/api/healthz`),
  ]);

  const config = writeConfig(await signedInCookieHeader());
  const result = spawnSync(
    "pnpm",
    ["dlx", "@lhci/cli@0.15.1", "autorun", `--config=${config}`],
    { cwd: root, stdio: "inherit", shell: process.platform === "win32" },
  );
  exitCode = result.status ?? 1;
} finally {
  for (const child of children) {
    child.kill();
  }
}
process.exit(exitCode);
