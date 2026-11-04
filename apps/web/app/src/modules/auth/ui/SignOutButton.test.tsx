import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { logoutAction } from "@/modules/auth/lib/auth-actions";
import { SignOutButton } from "@/modules/auth/ui/SignOutButton";
import { routerMock } from "@/test/mocks/navigation";
import { messages, renderWithProviders } from "@/test/render";

vi.mock("@/modules/auth/lib/auth-actions", () => ({
  logoutAction: vi.fn(),
}));

describe("SignOutButton", () => {
  it("revokes the session and returns to the sign-in page", async () => {
    vi.mocked(logoutAction).mockResolvedValue({ endSessionUrl: null });
    renderWithProviders(<SignOutButton />, { initialUserId: "user-1" });

    await userEvent.click(
      screen.getByRole("button", { name: messages.auth.signOut }),
    );

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith("/"));
    expect(logoutAction).toHaveBeenCalledOnce();
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it("signs out locally even when the revoke call fails", async () => {
    vi.mocked(logoutAction).mockRejectedValue(new Error("network"));
    renderWithProviders(<SignOutButton />, { initialUserId: "user-1" });

    await userEvent.click(
      screen.getByRole("button", { name: messages.auth.signOut }),
    );

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith("/"));
  });
});
