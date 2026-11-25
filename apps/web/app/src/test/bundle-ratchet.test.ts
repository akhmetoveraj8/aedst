// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  flattenLimits,
  lowerableTo,
  raisedLimits,
  unjustifiedRaises,
} from "../../../shared/scripts/bundle-ratchet.mjs";

const base = {
  totalJsGzipKB: 900,
  largestJsChunkGzipKB: 120,
  modules: { tasks: { routePrefix: "/[locale]/tasks", firstLoadGzipKB: 400 } },
  shell: { "/[locale]": 250 },
};

describe("flattenLimits", () => {
  it("keys top-level KB limits, modules and shell routes", () => {
    expect(Object.fromEntries(flattenLimits(base))).toEqual({
      totalJsGzipKB: 900,
      largestJsChunkGzipKB: 120,
      "modules.tasks": 400,
      "shell./[locale]": 250,
    });
  });
});

describe("raisedLimits", () => {
  it("reports only limits that went up, not new or lowered ones", () => {
    const head = {
      ...base,
      totalJsGzipKB: 950,
      largestJsChunkGzipKB: 110,
      shell: { "/[locale]": 250, "/[locale]/new": 300 },
    };
    expect(raisedLimits(base, head)).toEqual([
      { limit: "totalJsGzipKB", old: 900, new: 950 },
    ]);
  });
});

describe("unjustifiedRaises", () => {
  const entry = {
    date: "2026-11-25",
    limit: "totalJsGzipKB",
    old: 900,
    new: 950,
    reason: "measured 941 KB after the chart chunk",
  };

  it("accepts a raise with a newly added, matching increases entry", () => {
    expect(
      unjustifiedRaises(base, {
        ...base,
        totalJsGzipKB: 950,
        increases: [entry],
      }),
    ).toEqual([]);
  });

  it("rejects a raise without an entry, with a stale entry, or with a bad one", () => {
    const head = { ...base, totalJsGzipKB: 950 };
    expect(unjustifiedRaises(base, head)).toHaveLength(1);
    expect(
      unjustifiedRaises(
        { ...base, increases: [entry] },
        { ...head, increases: [entry] },
      ),
    ).toHaveLength(1);
    expect(
      unjustifiedRaises(base, { ...head, increases: [{ ...entry, new: 940 }] }),
    ).toHaveLength(1);
    expect(
      unjustifiedRaises(base, {
        ...head,
        increases: [{ ...entry, reason: " " }],
      }).at(0)?.why,
    ).toContain("no reason");
    expect(
      unjustifiedRaises(base, {
        ...head,
        increases: [{ ...entry, date: "yesterday" }],
      }).at(0)?.why,
    ).toContain("date");
  });
});

describe("lowerableTo", () => {
  it("suggests ~3 % above usage once usage is more than 5 % under the limit", () => {
    expect(lowerableTo(900, 1000)).toBe(927);
    expect(lowerableTo(950, 1000)).toBeNull();
    expect(lowerableTo(960, 1000)).toBeNull();
  });
});
