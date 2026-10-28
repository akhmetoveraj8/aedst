import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { logoutAction } from "@/modules/admin/lib/auth-actions";
import { AdminSignOutButton } from "@/modules/admin/ui/AdminSignOutButton";
import { routerMock } from "@/test/mocks/navigation";
import { messages, renderWithProviders } from "@/test/render";

vi.mock("@/modules/admin/lib/auth-actions", () => ({
  logoutAction: vi.fn(),
}));

describe("AdminSignOutButton", () => {
  it("revokes the session and returns to the site root", async () => {
    vi.mocked(logoutAction).mockResolvedValue({ endSessionUrl: null });
    renderWithProviders(<AdminSignOutButton />, { initialUserId: "user-1" });

    await userEvent.click(
      screen.getByRole("button", { name: messages.admin.signOut }),
    );

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith("/"));
    expect(logoutAction).toHaveBeenCalledOnce();
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it("signs out locally even when the revoke call fails", async () => {
    vi.mocked(logoutAction).mockRejectedValue(new Error("network"));
    renderWithProviders(<AdminSignOutButton />, { initialUserId: "user-1" });

    await userEvent.click(
      screen.getByRole("button", { name: messages.admin.signOut }),
    );

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith("/"));
  });
});
