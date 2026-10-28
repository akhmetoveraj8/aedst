import { describe, expect, it } from "vitest";

import { kindsFor, normalizeQuery } from "@/modules/search/lib/search-params";
import { DocumentKind } from "@/shared/api/connect/generated/aedst/search/v1/search_pb";

describe("search params", () => {
  it("maps the kind filter to SearchRequest.kinds (empty = every kind)", () => {
    expect(kindsFor("all")).toEqual([]);
    expect(kindsFor("task")).toEqual([DocumentKind.TASK]);
    expect(kindsFor("media")).toEqual([DocumentKind.MEDIA]);
  });

  it("trims and caps the query at the server's 200 characters", () => {
    expect(normalizeQuery("  hi  ")).toBe("hi");
    expect(normalizeQuery("x".repeat(250))).toHaveLength(200);
    expect(normalizeQuery("   ")).toBe("");
  });
});
