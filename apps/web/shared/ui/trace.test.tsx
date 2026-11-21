import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Trace, type TraceStep } from "@/shared/ui/trace";

const statusLabels = {
  pending: "Pending",
  running: "Running",
  success: "Done",
  error: "Failed",
  skipped: "Skipped",
};

const steps: TraceStep[] = [
  {
    id: "build",
    title: "Build",
    status: "success",
    detail: "Compiled 12 files",
    children: [{ id: "lint", title: "Lint", status: "skipped" }],
  },
  { id: "test", title: "Test", status: "pending" },
];

describe("Trace", () => {
  it("shows each status as text and expands a step from the keyboard", async () => {
    const user = userEvent.setup();
    render(<Trace steps={steps} statusLabels={statusLabels} />);

    expect(screen.getByText("Done")).toBeVisible();
    expect(screen.getByText("Pending")).toBeVisible();

    const trigger = screen.getByRole("button", { name: /Build/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Compiled 12 files")).not.toBeInTheDocument();

    await user.tab();
    expect(trigger).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Compiled 12 files")).toBeVisible();
    expect(screen.getByText("Lint")).toBeVisible();
    expect(screen.getByText("Skipped")).toBeVisible();
  });

  it("announces status changes only", () => {
    const { rerender } = render(
      <Trace steps={steps} statusLabels={statusLabels} />,
    );
    const live = screen.getByRole("status");
    expect(live).toBeEmptyDOMElement();

    rerender(<Trace steps={[...steps]} statusLabels={statusLabels} />);
    expect(live).toBeEmptyDOMElement();

    const next = steps.map((step) =>
      step.id === "test" ? { ...step, status: "running" as const } : step,
    );
    rerender(<Trace steps={next} statusLabels={statusLabels} />);
    expect(live).toHaveTextContent("Test: Running");
  });
});
