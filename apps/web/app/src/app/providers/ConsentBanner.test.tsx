import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import { ConsentBanner } from "@/app/providers/ConsentBanner";
import {
  ConsentProvider,
  useConsent,
} from "@/shared/lib/consent/ConsentProvider";
import { saveConsentAction } from "@/shared/lib/consent/consent-action";
import { messages } from "@/test/render";

const env = vi.hoisted(() => ({
  NEXT_PUBLIC_PRIVACY_POLICY_URL: undefined as string | undefined,
}));
vi.mock("@/shared/env/client", () => ({ clientEnv: env }));
vi.mock("@/shared/lib/consent/consent-action", () => ({
  saveConsentAction: vi.fn(),
}));

describe("ConsentBanner", () => {
  it("offers accept/decline and records the answer", async () => {
    vi.mocked(saveConsentAction).mockResolvedValue(undefined);
    const Probe = () => <p data-testid="state">{useConsent().consent}</p>;
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ConsentProvider initial="unknown">
          <Probe />
          <ConsentBanner />
        </ConsentProvider>
      </NextIntlClientProvider>,
    );

    expect(
      screen.getByRole("region", { name: messages.common.consent.title }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: messages.common.consent.accept }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("granted"),
    );
  });

  it("links the configured privacy policy, and only when one is configured", () => {
    const view = (
      <NextIntlClientProvider locale="en" messages={messages}>
        <ConsentProvider initial="unknown">
          <ConsentBanner />
        </ConsentProvider>
      </NextIntlClientProvider>
    );
    const { unmount } = render(view);
    expect(
      screen.queryByRole("link", {
        name: messages.common.consent.privacyPolicy,
      }),
    ).not.toBeInTheDocument();
    unmount();

    env.NEXT_PUBLIC_PRIVACY_POLICY_URL = "https://example.test/privacy";
    render(view);
    expect(
      screen.getByRole("link", { name: messages.common.consent.privacyPolicy }),
    ).toHaveAttribute("href", "https://example.test/privacy");
  });
});
