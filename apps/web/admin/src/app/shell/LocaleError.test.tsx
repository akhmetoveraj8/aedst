import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntlProvider } from "use-intl";
import { describe, expect, it, vi } from "vitest";

import commonMessages from "@/app/config/i18n/common/en.json";
import { LocaleError } from "@/app/shell/LocaleError";

// The kit imports "@sentry/nextjs" (aliased to @sentry/react); mock that specifier.
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  withScope: (callback: (scope: object) => unknown) =>
    callback({ setTag() {}, setContext() {}, setFingerprint() {} }),
}));

describe("LocaleError", () => {
  it("reports the error to Sentry and lets the user retry", async () => {
    const Sentry = await import("@sentry/nextjs");
    const reset = vi.fn();
    const error = new Error("boom");

    render(
      <IntlProvider locale="en" messages={{ common: commonMessages }}>
        <LocaleError error={error} reset={reset} />
      </IntlProvider>,
    );

    expect(
      screen.getByRole("heading", { name: commonMessages.errors.title }),
    ).toBeInTheDocument();
    expect(Sentry.captureException).toHaveBeenCalledWith(error);

    await userEvent.click(
      screen.getByRole("button", { name: commonMessages.actions.tryAgain }),
    );
    expect(reset).toHaveBeenCalledOnce();
  });
});
