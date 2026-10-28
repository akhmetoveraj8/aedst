import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { LocaleSwitcher } from "@/app/shell/LocaleSwitcher";
import { routerMock } from "@/test/mocks/navigation";
import { messages, renderWithProviders } from "@/test/render";

describe("LocaleSwitcher", () => {
  it("shows the current language under an accessible name", () => {
    renderWithProviders(<LocaleSwitcher />);
    expect(
      screen.getByRole("combobox", { name: messages.common.locale.label }),
    ).toHaveTextContent("English");
  });

  it("replaces the route with the chosen locale, keeping the path", async () => {
    renderWithProviders(<LocaleSwitcher />);
    await userEvent.click(
      screen.getByRole("combobox", { name: messages.common.locale.label }),
    );
    await userEvent.click(
      await screen.findByRole("option", { name: "العربية" }),
    );

    expect(routerMock.replace).toHaveBeenCalledWith("/", { locale: "ar" });
  });

  it("does nothing when the current language is picked again", async () => {
    renderWithProviders(<LocaleSwitcher />);
    await userEvent.click(
      screen.getByRole("combobox", { name: messages.common.locale.label }),
    );
    await userEvent.click(
      await screen.findByRole("option", { name: "English" }),
    );

    expect(routerMock.replace).not.toHaveBeenCalled();
  });
});
