import { describe, expect, it } from "vitest";

import {
  buildContentSecurityPolicy,
  buildReportingEndpoints,
  buildTrustedTypesReportOnlyPolicy,
  generateNonce,
  parseOrigins,
  sentryCspReportUri,
} from "@/app/config/security/csp";

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

  it("confines connections to same origin — no cross-origin API host", () => {
    expect(production).toContain("connect-src 'self'");
    expect(production).not.toMatch(/connect-src[^;]*http/);
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

  it("can leave out the https upgrade when the site is served over plain http", () => {
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

describe("media origins", () => {
  it("parses only real http(s) origins, deduplicated, without paths", () => {
    expect(
      parseOrigins(
        " https://bucket.s3.eu-central-1.amazonaws.com/path , javascript:alert(1), nonsense, https://bucket.s3.eu-central-1.amazonaws.com,http://127.0.0.1:9000",
      ),
    ).toEqual([
      "https://bucket.s3.eu-central-1.amazonaws.com",
      "http://127.0.0.1:9000",
    ]);
    expect(parseOrigins(undefined)).toEqual([]);
  });

  it("opens exactly upload (connect), images and media to object storage — nothing else", () => {
    const csp = buildContentSecurityPolicy({
      nonce: "abc",
      isDev: false,
      mediaOrigins: ["https://media.example.com"],
    });
    const directive = (name: string) =>
      csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";
    expect(directive("connect-src")).toBe(
      "connect-src 'self' https://media.example.com",
    );
    expect(directive("img-src")).toContain("https://media.example.com");
    expect(directive("media-src")).toContain("https://media.example.com");
    expect(directive("script-src")).not.toContain("media.example.com");
    expect(directive("default-src")).toBe("default-src 'self'");
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

  it("adds report-uri to the enforced policy and the Trusted Types report-only policy", () => {
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
