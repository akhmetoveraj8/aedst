import { describe, expect, it } from "vitest";

import { GET, HEAD } from "./route";

describe("/api/healthz", () => {
  it("answers 200 ok without touching any backend, uncached", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("supports HEAD for probes that do not read a body", () => {
    const response = HEAD();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
