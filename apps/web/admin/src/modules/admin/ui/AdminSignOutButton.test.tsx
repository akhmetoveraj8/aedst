import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AdminSignOutButton } from "@/modules/admin/ui/AdminSignOutButton";
import { requestLogout } from "@/shared/lib/auth/logout";
import { routerMock } from "@/test/mocks/navigation";
import { messages, renderWithProviders } from "@/test/render";

vi.mock("@/shared/lib/auth/logout", () => ({
  requestLogout: vi.fn(),
}));

describe("AdminSignOutButton", () => {
  it("revokes the session and returns to the site root", async () => {
    vi.mocked(requestLogout).mockResolvedValue({ endSessionUrl: null });
    renderWithProviders(<AdminSignOutButton />, { initialUserId: "user-1" });

    await userEvent.click(
      screen.getByRole("button", { name: messages.admin.signOut }),
    );

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith("/"));
    expect(requestLogout).toHaveBeenCalledOnce();
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it("signs out locally even when the revoke call fails", async () => {
    vi.mocked(requestLogout).mockRejectedValue(new Error("network"));
    renderWithProviders(<AdminSignOutButton />, { initialUserId: "user-1" });

    await userEvent.click(
      screen.getByRole("button", { name: messages.admin.signOut }),
    );

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith("/"));
  });
});
