// @vitest-environment node
import { describe, expect, it } from "vitest";
import { findProblems } from "../../scripts/check-seo-placeholders.mjs";

const real = {
  siteUrl: "https://app.example.com",
  descriptions: { a: "Plan your week with Example." },
};

describe("check-seo-placeholders", () => {
  it("passes real values", () => {
    expect(findProblems(real)).toEqual([]);
  });

  it.each([
    "http://localhost:3000",
    "http://127.0.0.1:3100",
    "http://app.localhost",
  ])("rejects a local origin: %s", (siteUrl) => {
    expect(findProblems({ ...real, siteUrl })).toHaveLength(1);
  });

  it("rejects template copy in any description, case-insensitively", () => {
    const problems = findProblems({
      ...real,
      descriptions: {
        a: "A fast, accessible Task Manager",
        b: "built on the AEDST stack",
      },
    });
    expect(problems).toHaveLength(2);
  });
});
