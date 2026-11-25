import { describe, expect, it } from "vitest";

import { createLogger, errorFields } from "./logger";

describe("logger", () => {
  it("writes one JSON object per line and honours the level", () => {
    const lines: [string, boolean][] = [];
    const log = createLogger(
      "warn",
      (line, isError) => lines.push([line, isError]),
      () => 0,
    );
    log.info("hidden");
    log.warn("shown", { requestId: "r1" });
    log.error("bad");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]?.[0] ?? "")).toEqual({
      level: "warn",
      time: "1970-01-01T00:00:00.000Z",
      msg: "shown",
      requestId: "r1",
    });
    expect(lines[1]?.[1]).toBe(true);
  });

  it("keeps only the name and a truncated message of an error", () => {
    const fields = errorFields(
      Object.assign(new Error("x".repeat(500)), { token: "secret" }),
    );
    expect(Object.keys(fields)).toEqual(["errorName", "errorMessage"]);
    expect(String(fields["errorMessage"])).toHaveLength(300);
    expect(errorFields("str")).toEqual({ errorName: "NonError" });
  });
});
