// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  budgetStatus,
  containsReplayRecorder,
} from "../../scripts/bundle-status.mjs";

describe("budgetStatus", () => {
  it("is ok below 95 % of the budget", () => {
    expect(budgetStatus(400, 480)).toBe("ok");
    expect(budgetStatus(455.9, 480)).toBe("ok");
  });

  it("warns from 95 % up to and including the limit", () => {
    expect(budgetStatus(456, 480)).toBe("warn");
    expect(budgetStatus(479.9, 480)).toBe("warn");
    expect(budgetStatus(480, 480)).toBe("warn");
  });

  it("fails above the limit", () => {
    expect(budgetStatus(480.1, 480)).toBe("fail");
  });
});

describe("containsReplayRecorder", () => {
  it("detects the rrweb-based recorder but not the integration stub", () => {
    expect(containsReplayRecorder("x recordingMode y rrweb z")).toBe(true);
    expect(containsReplayRecorder("replayIntegration maskAllText")).toBe(false);
  });
});
