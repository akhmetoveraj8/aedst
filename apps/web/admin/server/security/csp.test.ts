import { describe, expect, it } from "vitest";

import {
  buildApiContentSecurityPolicy,
  buildContentSecurityPolicy,
  buildReportingEndpoints,
  buildTrustedTypesReportOnlyPolicy,
  generateNonce,
  sentryCspReportUri,
} from "./csp";

describe("generateNonce", () => {
  it("is unique per call and base64", () => {
    const first = generateNonce();
    expect(first).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(generateNonce()).not.toBe(first);
  });
});

describe("buildContentSecurityPolicy", () => {
  const production = buildContentSecurityPolicy({ nonce: "abc", isDev: false });

  it("allows scripts only via the nonce (no unsafe-inline / unsafe-eval)", () => {
    const script = production
      .split("; ")
      .find((d) => d.startsWith("script-src"));
    expect(script).toContain("'nonce-abc'");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
  });

  it("confines connections to the same origin", () => {
    expect(production).toContain("connect-src 'self'");
    expect(production).not.toMatch(/connect-src[^;]*http/);
  });

  it("has no service worker, manifest or frames (admin is not a PWA)", () => {
    for (const directive of [
      "worker-src 'none'",
      "manifest-src 'none'",
      "frame-src 'none'",
    ]) {
      expect(production).toContain(directive);
    }
  });

  it("locks down framing, plugins, base URI and forms", () => {
    for (const directive of [
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "upgrade-insecure-requests",
    ]) {
      expect(production).toContain(directive);
    }
  });

  it("can leave out the https upgrade when served over plain http", () => {
    const http = buildContentSecurityPolicy({
      nonce: "abc",
      isDev: false,
      upgradeInsecureRequests: false,
    });
    expect(http).not.toContain("upgrade-insecure-requests");
  });

  it("relaxes only what development tooling needs", () => {
    const dev = buildContentSecurityPolicy({ nonce: "abc", isDev: true });
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).toContain("ws:");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });
});

describe("violation reporting", () => {
  it("derives Sentry's security endpoint from the DSN", () => {
    expect(
      sentryCspReportUri("https://publickey@o42.ingest.sentry.io/1234"),
    ).toBe(
      "https://o42.ingest.sentry.io/api/1234/security/?sentry_key=publickey",
    );
    expect(sentryCspReportUri(undefined)).toBeNull();
    expect(sentryCspReportUri("not a url")).toBeNull();
    expect(sentryCspReportUri("https://o42.ingest.sentry.io/1234")).toBeNull();
  });

  it("adds report-uri to the enforced and the Trusted Types report-only policy", () => {
    const uri = "https://o1.ingest.sentry.io/api/1/security/?sentry_key=k";
    expect(
      buildContentSecurityPolicy({ nonce: "n", isDev: false, reportUri: uri }),
    ).toContain(`report-uri ${uri}; report-to csp-endpoint`);
    expect(buildTrustedTypesReportOnlyPolicy(uri)).toBe(
      `require-trusted-types-for 'script'; report-uri ${uri}; report-to csp-endpoint`,
    );
    expect(buildReportingEndpoints(uri)).toBe(`csp-endpoint="${uri}"`);
  });
});

describe("buildApiContentSecurityPolicy", () => {
  it("loads nothing and cannot be framed", () => {
    expect(buildApiContentSecurityPolicy()).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
  });
});
