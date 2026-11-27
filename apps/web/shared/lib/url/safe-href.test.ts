import { describe, expect, it } from "vitest";

import { safeHref } from "@/shared/lib/url/safe-href";

describe("safeHref", () => {
  it.each([
    ["https://example.com/a?b=1#c", "https://example.com/a?b=1#c"],
    ["http://example.com", "http://example.com/"],
    ["  https://example.com/x  ", "https://example.com/x"],
    ["HTTPS://EXAMPLE.com", "https://example.com/"],
    ["mailto:team@example.com", "mailto:team@example.com"],
    ["/docs/page", "/docs/page"],
    ["./a", "./a"],
    ["../a", "../a"],
    ["?q=1", "?q=1"],
    ["#section", "#section"],
    ["docs/page", "docs/page"],
  ])("accepts %s", (input, expected) => {
    expect(safeHref(input)).toBe(expected);
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "java\rscript:alert(1)",
    "\u0001javascript:alert(1)",
    "​javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "blob:https://example.com/uuid",
    "ftp://example.com/x",
    "tel:+123",
    "//evil.example/path",
    "///evil.example/path",
    "/\\evil.example",
    "\\\\evil.example",
    "https://user:pass@example.com/",
    "https:",
    "foo:bar",
    "javascript&colon;alert(1)x:y",
    "http://exa mple.com",
    "",
    "   ",
  ])("rejects %j", (input) => {
    expect(safeHref(input)).toBeUndefined();
  });

  it("rejects zero-width and bidi characters hidden in the scheme", () => {
    for (const code of [0x200b, 0x202e, 0x2060, 0xfeff, 0x0085]) {
      const hidden = String.fromCodePoint(code);
      expect(safeHref(`${hidden}javascript:alert(1)`)).toBeUndefined();
      expect(safeHref(`java${hidden}script:alert(1)`)).toBeUndefined();
      expect(safeHref(`https://exa${hidden}mple.com`)).toBeUndefined();
    }
  });

  it("rejects non-strings", () => {
    expect(safeHref(undefined)).toBeUndefined();
    expect(safeHref(null)).toBeUndefined();
  });
});
