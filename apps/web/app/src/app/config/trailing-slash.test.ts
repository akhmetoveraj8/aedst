import { describe, expect, it } from "vitest";
import { withoutTrailingSlash } from "./trailing-slash";

describe("withoutTrailingSlash", () => {
  it("strips one or more trailing slashes from page paths", () => {
    expect(withoutTrailingSlash("/en/")).toBe("/en");
    expect(withoutTrailingSlash("/en/tasks/")).toBe("/en/tasks");
    expect(withoutTrailingSlash("/en//")).toBe("/en");
  });

  it("leaves canonical paths and the origin root alone", () => {
    expect(withoutTrailingSlash("/en")).toBeNull();
    expect(withoutTrailingSlash("/")).toBeNull();
  });

  it("never touches the PostHog proxy or API paths", () => {
    expect(withoutTrailingSlash("/ingest/e/")).toBeNull();
    expect(withoutTrailingSlash("/ingest/")).toBeNull();
    expect(withoutTrailingSlash("/api/rpc/")).toBeNull();
    expect(withoutTrailingSlash("/monitoring/")).toBeNull();
  });

  it("does not exempt look-alike prefixes", () => {
    expect(withoutTrailingSlash("/ingestion/")).toBe("/ingestion");
  });
});
