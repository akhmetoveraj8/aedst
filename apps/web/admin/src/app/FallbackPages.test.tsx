import * as Sentry from "@sentry/nextjs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { fallbackMessages } from "@/app/config/i18n/fallback-messages";
import GlobalError from "@/app/global-error";
import RootNotFound from "@/app/not-found";

const acceptLanguage = vi.hoisted(() => ({ value: "en-US,en;q=0.9" }));

vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => acceptLanguage.value }),
}));
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  withScope: (callback: (scope: object) => unknown) =>
    callback({ setTag() {}, setContext() {}, setFingerprint() {} }),
}));

// These pages render their own <html>; RTL mounts them inside a <div>, which
// React tolerates for assertions on content (with a validateDOMNesting warning).
function quietly<T>(run: () => T): T {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    return run();
  } finally {
    spy.mockRestore();
  }
}

describe("RootNotFound (no locale segment)", () => {
  it("localizes from Accept-Language and titles the page", async () => {
    acceptLanguage.value = "ru-RU,ru;q=0.9";

    const element = await RootNotFound();
    quietly(() => render(element));

    expect(
      screen.getByRole("heading", { name: fallbackMessages.ru.notFoundTitle }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: fallbackMessages.ru.goHome }),
    ).toHaveAttribute("href", "/");
    expect(element.props.lang).toBe("ru");
  });

  it("uses right-to-left for Arabic", async () => {
    acceptLanguage.value = "ar";

    const element = await RootNotFound();

    expect(element.props.dir).toBe("rtl");
  });

  it("falls back to English", async () => {
    acceptLanguage.value = "fr-FR";

    expect((await RootNotFound()).props.lang).toBe("en");
  });
});

describe("GlobalError", () => {
  it("reports the error to Sentry and shows a translated fallback", () => {
    const error = new Error("root layout exploded");

    quietly(() => render(<GlobalError error={error} />));

    expect(Sentry.captureException).toHaveBeenCalledWith(error);
    expect(
      screen.getByRole("heading", { name: fallbackMessages.en.errorTitle }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: fallbackMessages.en.goHome }),
    ).toBeVisible();
  });

  it("switches to the locale in the URL", () => {
    window.history.pushState({}, "", "/uz/tasks");

    quietly(() => render(<GlobalError error={new Error("x")} />));

    expect(
      screen.getByRole("heading", { name: fallbackMessages.uz.errorTitle }),
    ).toBeVisible();
  });
});
