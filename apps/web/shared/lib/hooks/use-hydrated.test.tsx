import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { useHydrated } from "@/shared/lib/hooks/use-hydrated";

function Button() {
  const hydrated = useHydrated();
  return (
    <button type="submit" disabled={!hydrated}>
      go
    </button>
  );
}

describe("useHydrated", () => {
  it("is false in server-rendered HTML, so a form cannot submit natively before hydration", () => {
    expect(renderToString(<Button />)).toContain("disabled");
  });

  it("is true once running in the browser", () => {
    render(<Button />);

    expect(screen.getByRole("button", { name: "go" })).toBeEnabled();
  });
});
