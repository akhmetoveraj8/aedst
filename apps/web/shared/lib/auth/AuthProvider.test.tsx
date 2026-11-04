import * as Sentry from "@sentry/nextjs";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AuthProvider, useAuth } from "@/shared/lib/auth/AuthProvider";

vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

function Probe() {
  const { userId, isAuthenticated, signOut } = useAuth();
  return (
    <div>
      <p>{isAuthenticated ? `in:${userId}` : "out"}</p>
      <button type="button" onClick={signOut}>
        sign out
      </button>
    </div>
  );
}

describe("AuthProvider", () => {
  it("starts from the server-provided user — no signed-out flash", () => {
    render(
      <AuthProvider initialUserId="u-1">
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByText("in:u-1")).toBeInTheDocument();
  });

  it("starts signed out without an initial user", () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByText("out")).toBeInTheDocument();
  });

  it("signs out locally and mirrors it into Sentry with a breadcrumb", async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider initialUserId="u-1">
        <Probe />
      </AuthProvider>,
    );
    expect(Sentry.setUser).toHaveBeenLastCalledWith({ id: "u-1" });

    await user.click(screen.getByRole("button", { name: "sign out" }));

    expect(screen.getByText("out")).toBeInTheDocument();
    expect(Sentry.setUser).toHaveBeenLastCalledWith(null);
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: "auth", message: "sign-out" }),
    );
  });

  it("follows the server when a refresh changes the session", () => {
    const { rerender } = render(
      <AuthProvider initialUserId="u-1">
        <Probe />
      </AuthProvider>,
    );

    rerender(
      <AuthProvider initialUserId={null}>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByText("out")).toBeInTheDocument();
  });

  it("stores nothing in web storage — the session lives only in httpOnly cookies", () => {
    render(
      <AuthProvider initialUserId="u-1">
        <Probe />
      </AuthProvider>,
    );

    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("throws a clear error when used outside the provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/within <AuthProvider>/);
    spy.mockRestore();
  });
});
