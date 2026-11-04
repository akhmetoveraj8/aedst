import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import commonMessages from "@/app/config/i18n/common/en.json";
import { reportError } from "@/shared/lib/errors/report-error";
import AppError from "./error";

vi.mock("@/shared/lib/errors/report-error", () => ({ reportError: vi.fn() }));

describe("AppError (signed-in area)", () => {
  it("reports the crash with its digest and lets the user retry", async () => {
    const reset = vi.fn();
    const error = Object.assign(new Error("boom"), { digest: "d1" });
    render(
      <NextIntlClientProvider locale="en" messages={{ common: commonMessages }}>
        <AppError error={error} reset={reset} />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      commonMessages.errors.title,
    );
    expect(reportError).toHaveBeenCalledWith(error, {
      source: "route",
      extra: { digest: "d1" },
    });
    await userEvent.click(
      screen.getByRole("button", { name: commonMessages.actions.tryAgain }),
    );
    expect(reset).toHaveBeenCalledOnce();
  });

  it("reports errors without a digest too", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ common: commonMessages }}>
        <AppError error={new Error("client")} reset={vi.fn()} />
      </NextIntlClientProvider>,
    );
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), {
      source: "route",
      extra: undefined,
    });
  });
});
