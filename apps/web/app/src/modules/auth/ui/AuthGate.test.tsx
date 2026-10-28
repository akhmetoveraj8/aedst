import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AuthGate } from "@/modules/auth/ui/AuthGate";
import { messages, renderWithProviders } from "@/test/render";

describe("AuthGate", () => {
  it("offers sign-in and account creation through the OIDC login route", () => {
    renderWithProviders(<AuthGate />);

    expect(
      screen.getByRole("heading", { name: messages.auth.login.title }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: messages.auth.login.submit }),
    ).toHaveAttribute("href", "/api/auth/login");
    expect(
      screen.getByRole("link", { name: messages.auth.login.switchAction }),
    ).toHaveAttribute("href", "/api/auth/login?screen_hint=register");
  });

  it("passes the post-login destination to both links, encoded", () => {
    renderWithProviders(<AuthGate redirectTo="/tasks?status=done&q=a b" />);

    const next = encodeURIComponent("/tasks?status=done&q=a b").replace(
      /%20/g,
      "+",
    );
    expect(
      screen.getByRole("link", { name: messages.auth.login.submit }),
    ).toHaveAttribute("href", `/api/auth/login?next=${next}`);
    expect(
      screen.getByRole("link", { name: messages.auth.login.switchAction }),
    ).toHaveAttribute(
      "href",
      `/api/auth/login?next=${next}&screen_hint=register`,
    );
  });

  it("explains why the last sign-in attempt failed", () => {
    renderWithProviders(<AuthGate error="denied" />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      messages.auth.login.errors.denied,
    );
  });

  it("shows no alert by default", () => {
    renderWithProviders(<AuthGate />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
