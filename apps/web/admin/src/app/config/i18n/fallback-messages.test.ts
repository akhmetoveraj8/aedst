import { describe, expect, it } from "vitest";

import {
  fallbackMessages,
  pickFallbackLocale,
} from "@/app/config/i18n/fallback-messages";
import { locales } from "@/shared/i18n/locales";

describe("fallbackMessages", () => {
  it("has a complete entry for every supported locale", () => {
    for (const locale of locales) {
      for (const value of Object.values(fallbackMessages[locale])) {
        expect(value).toBeTruthy();
      }
    }
  });
});

describe("pickFallbackLocale", () => {
  it("prefers the locale in the URL path", () => {
    expect(
      pickFallbackLocale({ pathname: "/ru/tasks", languages: ["ar"] }),
    ).toBe("ru");
  });

  it("falls back to the first supported language, ignoring region and q-values", () => {
    expect(
      pickFallbackLocale({ pathname: "/x", languages: ["fr-FR", "uz-UZ"] }),
    ).toBe("uz");
    expect(
      pickFallbackLocale({ languages: "de;q=0.9, tj-TJ;q=0.8, en;q=0.7" }),
    ).toBe("tj");
  });

  it("defaults to English when nothing matches", () => {
    expect(pickFallbackLocale({ languages: ["fr"] })).toBe("en");
    expect(pickFallbackLocale({})).toBe("en");
    expect(pickFallbackLocale({ languages: null })).toBe("en");
  });
});
