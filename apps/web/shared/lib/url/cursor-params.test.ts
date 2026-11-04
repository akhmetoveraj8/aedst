import { describe, expect, it } from "vitest";

import { loadCursorParams } from "@/shared/lib/url/cursor-params";

describe("cursor params", () => {
  it("defaults to an empty search on the first page", () => {
    expect(loadCursorParams({})).toEqual({ q: "", cursors: [] });
  });

  it("reads the search and the stack of visited page tokens", () => {
    expect(loadCursorParams({ q: "ann", cursors: "t1,t2" })).toEqual({
      q: "ann",
      cursors: ["t1", "t2"],
    });
  });

  it("reads the same shape from a URLSearchParams string", () => {
    expect(loadCursorParams("?q=x&cursors=a")).toEqual({
      q: "x",
      cursors: ["a"],
    });
  });
});
