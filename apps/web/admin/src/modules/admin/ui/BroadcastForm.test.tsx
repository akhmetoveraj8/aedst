import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { BroadcastForm } from "@/modules/admin/ui/BroadcastForm";
import { messages, renderWithProviders } from "@/test/render";

const t = messages.admin.broadcast;

describe("BroadcastForm accessibility", () => {
  it("flags an invalid field with aria-invalid and links it to its announced error", async () => {
    renderWithProviders(<BroadcastForm />);
    await userEvent.click(screen.getByRole("button", { name: t.send }));

    const title = await screen.findByLabelText(t.titleLabel);
    await waitFor(() => expect(title).toHaveAttribute("aria-invalid", "true"));
    const errorId = title.getAttribute("aria-describedby");
    expect(errorId).toBeTruthy();
    const error = document.getElementById(errorId ?? "");
    expect(error).toHaveAttribute("role", "alert");
    expect(error).toHaveTextContent(t.titleRequired);
  });

  it("leaves valid fields unmarked", async () => {
    renderWithProviders(<BroadcastForm />);
    await userEvent.click(screen.getByRole("button", { name: t.send }));
    const title = await screen.findByLabelText(t.titleLabel);
    await waitFor(() => expect(title).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByLabelText(t.body)).not.toHaveAttribute("aria-invalid");
  });
});
