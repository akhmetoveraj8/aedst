import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CurrentUser } from "@/modules/auth/ui/CurrentUser";
import { getSessionIdentity } from "@/shared/lib/auth/session";
import { messages } from "@/test/render";

vi.mock("@/shared/lib/auth/session", () => ({
  getSessionIdentity: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: { email?: string }) =>
    key === "signedInAs"
      ? messages.auth.signedInAs.replace("{email}", values?.email ?? "")
      : key,
}));

describe("CurrentUser (Server Component)", () => {
  it("renders the signed-in email from the ID token", async () => {
    vi.mocked(getSessionIdentity).mockResolvedValue({
      email: "ada@example.com",
    });

    render(await CurrentUser());

    expect(screen.getByText("Signed in as ada@example.com")).toBeVisible();
  });

  it("falls back to the username when the ID token carries no email", async () => {
    vi.mocked(getSessionIdentity).mockResolvedValue({ username: "ada" });

    render(await CurrentUser());

    expect(screen.getByText("Signed in as ada")).toBeVisible();
  });

  it("renders nothing when there is no identity to show", async () => {
    vi.mocked(getSessionIdentity).mockResolvedValue({});
    const first = render(await CurrentUser());
    expect(first.container).toBeEmptyDOMElement();

    vi.mocked(getSessionIdentity).mockResolvedValue(null);
    const second = render(await CurrentUser());
    expect(second.container).toBeEmptyDOMElement();
  });
});
