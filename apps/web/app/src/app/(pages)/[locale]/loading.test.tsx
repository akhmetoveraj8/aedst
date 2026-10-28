import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "@/test/render";
import LocaleLoading from "./loading";

describe("LocaleLoading", () => {
  it("renders an accessible loading indicator", () => {
    renderWithProviders(<LocaleLoading />);

    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });
});
