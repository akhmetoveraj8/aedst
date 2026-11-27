import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { withSlot } from "@/shared/lib/utils/with-slot";

describe("withSlot", () => {
  it("adds the slot name and merges classes with the caller's last", () => {
    const Part = withSlot("p", "demo-part", "text-sm p-2");
    render(<Part className="p-4">hello</Part>);
    const el = screen.getByText("hello");
    expect(el).toHaveAttribute("data-slot", "demo-part");
    expect(el).toHaveClass("text-sm", "p-4");
    expect(el).not.toHaveClass("p-2");
  });

  it("passes other props through", () => {
    const Part = withSlot("div", "x");
    render(<Part aria-label="named" />);
    expect(screen.getByLabelText("named")).toHaveAttribute("data-slot", "x");
  });
});
