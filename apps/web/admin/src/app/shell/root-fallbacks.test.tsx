import * as Sentry from "@sentry/nextjs";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fallbackMessages } from "@/app/config/i18n/fallback-messages";
import { RootError } from "@/app/shell/RootError";
import { RootNotFound } from "@/app/shell/RootNotFound";

// The kit imports "@sentry/nextjs" (aliased to @sentry/react); mock that specifier.
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  withScope: (callback: (scope: object) => unknown) =>
    callback({ setTag() {}, setContext() {}, setFingerprint() {} }),
}));

afterEach(() => {
  window.history.pushState({}, "", "/");
});

describe("RootNotFound (no locale layout)", () => {
  it("localizes from the locale in the URL", () => {
    window.history.pushState({}, "", "/ru/nowhere");

    render(<RootNotFound />);

    expect(
      screen.getByRole("heading", { name: fallbackMessages.ru.notFoundTitle }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: fallbackMessages.ru.goHome }),
    ).toHaveAttribute("href", "/");
  });

  it("falls back to the browser language, then English", () => {
    render(<RootNotFound />);

    expect(
      screen.getByRole("heading", { name: fallbackMessages.en.notFoundTitle }),
    ).toBeVisible();
  });
});

describe("RootError", () => {
  it("reports the error to Sentry and shows a translated fallback", () => {
    const error = new Error("session probe exploded");

    render(<RootError error={error} reset={() => {}} />);

    expect(Sentry.captureException).toHaveBeenCalledWith(error);
    expect(
      screen.getByRole("heading", { name: fallbackMessages.en.errorTitle }),
    ).toBeVisible();
  });

  it("uses right-to-left for Arabic", () => {
    window.history.pushState({}, "", "/ar/admin");

    render(<RootError error={new Error("x")} reset={() => {}} />);

    expect(document.documentElement.dir).toBe("rtl");
  });
});
