import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PriorityBadge } from "@/modules/tasks/ui/PriorityBadge";
import { StatusBadge } from "@/modules/tasks/ui/StatusBadge";
import {
  TaskPriority,
  TaskStatus,
} from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";
import { renderWithProviders } from "@/test/render";

describe("StatusBadge", () => {
  it.each([
    [TaskStatus.TODO, "Todo"],
    [TaskStatus.IN_PROGRESS, "In progress"],
    [TaskStatus.DONE, "Done"],
  ])(
    "labels status %s for screen readers and sighted users",
    (status, label) => {
      renderWithProviders(<StatusBadge status={status} />);

      // The visible label is hidden from assistive tech; the sr-only text says
      // what the value is *of*, so colour is never the only carrier.
      expect(
        screen.getByText(label, { selector: "[aria-hidden]" }),
      ).toBeVisible();
      expect(
        screen.getByText(new RegExp(`Status: ${label}`, "i")),
      ).toBeInTheDocument();
    },
  );

  it("renders nothing for an unspecified status", () => {
    const { container } = renderWithProviders(
      <StatusBadge status={TaskStatus.UNSPECIFIED} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe("PriorityBadge", () => {
  it.each([
    [TaskPriority.LOW, "Low"],
    [TaskPriority.MEDIUM, "Medium"],
    [TaskPriority.HIGH, "High"],
    [TaskPriority.URGENT, "Urgent"],
  ])("labels priority %s", (priority, label) => {
    renderWithProviders(<PriorityBadge priority={priority} />);

    expect(
      screen.getByText(label, { selector: "[aria-hidden]" }),
    ).toBeVisible();
    expect(
      screen.getByText(new RegExp(`Priority: ${label}`, "i")),
    ).toBeInTheDocument();
  });

  it("renders nothing for an unspecified priority", () => {
    const { container } = renderWithProviders(
      <PriorityBadge priority={TaskPriority.UNSPECIFIED} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
