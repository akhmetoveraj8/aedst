import { describe, expect, it } from "vitest";

import {
  isGlobalPrivacyControl,
  parseConsent,
  parseConsentRecord,
  serializeConsent,
} from "@/shared/lib/consent/consent-cookie";

describe("consent cookie", () => {
  it("round-trips {version, choice, at}", () => {
    const at = new Date("2026-10-08T10:00:00Z");
    const value = serializeConsent("denied", at);
    expect(parseConsentRecord(value)).toEqual({
      version: 1,
      choice: "denied",
      at: "2026-10-08T10:00:00.000Z",
    });
    expect(parseConsent(value)).toBe("denied");
  });

  it("migrates the legacy bare value", () => {
    expect(parseConsentRecord("granted")).toEqual({
      version: 1,
      choice: "granted",
      at: "",
    });
    expect(parseConsent("denied")).toBe("denied");
  });

  it("asks again when the stored version is older than the current one", () => {
    expect(
      parseConsent(JSON.stringify({ version: 0, choice: "granted", at: "" })),
    ).toBe("unknown");
  });

  it.each([
    undefined,
    "",
    "yes",
    "{",
    "null",
    JSON.stringify({ version: 1, choice: "maybe" }),
    JSON.stringify({ choice: "granted" }),
  ])("treats garbage as no answer: %j", (value) => {
    expect(parseConsent(value)).toBe("unknown");
  });
});

describe("isGlobalPrivacyControl", () => {
  it("is true only for Sec-GPC: 1", () => {
    expect(isGlobalPrivacyControl(new Headers({ "sec-gpc": "1" }))).toBe(true);
    expect(isGlobalPrivacyControl(new Headers({ "sec-gpc": "0" }))).toBe(false);
    expect(isGlobalPrivacyControl(new Headers())).toBe(false);
  });
});
