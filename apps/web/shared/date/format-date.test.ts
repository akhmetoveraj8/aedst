import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatDate,
  formatDateInputValue,
  formatDateTime,
  parseDateInputValue,
} from "@/shared/date/format-date";
import { locales } from "@/shared/i18n/locales";

const date = new Date(2026, 0, 15, 14, 30);

describe("formatDate / formatDateTime", () => {
  it("formats per locale with date-fns", () => {
    expect(formatDate(date, "en")).toBe("Jan 15, 2026");
    expect(formatDate(date, "ru")).toContain("2026");
    expect(formatDateTime(date, "en")).toContain("2:30 PM");
  });

  it("gives every supported locale a formatter (Tajik falls back to Russian)", () => {
    for (const locale of locales) {
      expect(formatDate(date, locale).length).toBeGreaterThan(4);
    }
    expect(formatDate(date, "tj")).toBe(formatDate(date, "ru"));
  });
});

describe("formatDateInputValue", () => {
  it("renders the local calendar day as yyyy-MM-dd", () => {
    expect(formatDateInputValue(new Date(2026, 0, 5, 23, 59))).toBe(
      "2026-01-05",
    );
  });
});

describe("parseDateInputValue", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    "America/Los_Angeles",
    "Pacific/Honolulu",
    "UTC",
    "Asia/Dushanbe",
    "Pacific/Kiritimati",
  ])("round-trips the picked day in %s", (tz) => {
    vi.stubEnv("TZ", tz); // Node re-reads TZ on assignment.
    const parsed = parseDateInputValue("2026-01-15");
    expect(formatDateInputValue(parsed)).toBe("2026-01-15");
    expect(formatDate(parsed, "en")).toBe("Jan 15, 2026");
    expect(parsed.getHours()).toBe(0);
  });
});
