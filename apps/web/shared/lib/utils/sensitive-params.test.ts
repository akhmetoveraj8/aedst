import { describe, expect, it } from "vitest";

import { redactSensitiveParams } from "@/shared/lib/utils/sensitive-params";

describe("redactSensitiveParams", () => {
  it("filters q, next and credentials but keeps harmless params", () => {
    expect(
      redactSensitiveParams(
        "https://app.test/en/search?q=secret+text&kind=task&next=%2Fadmin&code=abc#top",
      ),
    ).toBe(
      "https://app.test/en/search?q=[Filtered]&kind=task&next=[Filtered]&code=[Filtered]#top",
    );
  });

  it("leaves URLs without a query string alone", () => {
    expect(redactSensitiveParams("https://app.test/en/tasks")).toBe(
      "https://app.test/en/tasks",
    );
  });

  it("matches names case-insensitively and percent-encoded", () => {
    expect(redactSensitiveParams("/x?Q=1&%6Eext=2")).toBe(
      "/x?Q=[Filtered]&%6Eext=[Filtered]",
    );
  });
});
