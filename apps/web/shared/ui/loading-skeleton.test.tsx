import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LoadingSkeleton } from "@/shared/ui/loading-skeleton";
import { messages, renderWithProviders } from "@/test/render";

describe("LoadingSkeleton", () => {
  it("is a busy status region with a translated accessible name", () => {
    renderWithProviders(<LoadingSkeleton className="h-8 w-8" />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(region).toHaveTextContent(messages.common.a11y.loading);
  });
});
