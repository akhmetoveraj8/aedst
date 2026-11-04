import { describe, expect, it, vi } from "vitest";

import {
  formatBytes,
  formatNumber,
  formatRelativeTime,
} from "@/shared/intl/format";

describe("formatNumber", () => {
  it("groups digits per locale", () => {
    expect(formatNumber(1234567, "en")).toBe("1,234,567");
    expect(formatNumber(1234567n, "en")).toBe("1,234,567");
  });

  it("accepts the app's Tajik code, which is not a valid BCP 47 tag", () => {
    expect(() => formatNumber(1234, "tj")).not.toThrow();
  });
});

describe("formatBytes", () => {
  it("abbreviates large counts", () => {
    expect(formatBytes(1_500_000, "en")).toContain("M");
  });
});

describe("formatRelativeTime", () => {
  it("speaks naturally for -1 day and for a future offset", () => {
    expect(formatRelativeTime(-1, "day", "en")).toBe("yesterday");
    expect(formatRelativeTime(3, "day", "en")).toBe("in 3 days");
  });
});

describe("Tajik locale", () => {
  it("hands Intl the BCP 47 tag `tg`, never the app code `tj`", async () => {
    vi.resetModules();
    const tags: unknown[] = [];
    const NumberFormat = Intl.NumberFormat;
    const RelativeTimeFormat = Intl.RelativeTimeFormat;
    vi.spyOn(Intl, "NumberFormat").mockImplementation(function (
      this: unknown,
      ...args: ConstructorParameters<typeof Intl.NumberFormat>
    ) {
      tags.push(args[0]);
      return new NumberFormat(...args);
    } as unknown as typeof Intl.NumberFormat);
    vi.spyOn(Intl, "RelativeTimeFormat").mockImplementation(function (
      this: unknown,
      ...args: ConstructorParameters<typeof Intl.RelativeTimeFormat>
    ) {
      tags.push(args[0]);
      return new RelativeTimeFormat(...args);
    } as unknown as typeof Intl.RelativeTimeFormat);

    const fresh = await import("@/shared/intl/format");
    fresh.formatNumber(1, "tj");
    fresh.formatBytes(1, "tj");
    fresh.formatRelativeTime(1, "day", "tj");

    expect(tags).toEqual(["tg", "tg", "tg"]);
    expect(new NumberFormat("tg").resolvedOptions().locale).toBe("tg");
  });
});
