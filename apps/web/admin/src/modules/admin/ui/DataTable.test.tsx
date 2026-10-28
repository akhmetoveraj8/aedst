import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { type AdminColumn, DataTable } from "@/modules/admin/ui/DataTable";
import { renderWithProviders } from "@/test/render";

type Row = { id: string; name: string; count: number };

// Module scope, as the component's contract demands: a new array per render
// would rebuild the row model.
const columns: AdminColumn<Row>[] = [
  { accessorKey: "name", header: "Name" },
  { id: "count", header: "Count", cell: ({ row }) => `${row.original.count}x` },
];

function renderTable(
  props: Partial<Parameters<typeof DataTable<Row>>[0]> = {},
) {
  const onPrevious = vi.fn();
  const onNext = vi.fn();
  renderWithProviders(
    <DataTable<Row>
      label="Things"
      columns={columns}
      data={[
        { id: "1", name: "alpha", count: 2 },
        { id: "2", name: "beta", count: 5 },
      ]}
      isLoading={false}
      emptyText="Nothing here."
      hasPrevious={false}
      hasNext={false}
      onPrevious={onPrevious}
      onNext={onNext}
      {...props}
    />,
  );
  return { onPrevious, onNext };
}

describe("DataTable", () => {
  it("renders headers and one row per item, using custom cells", () => {
    renderTable();

    const table = screen.getByRole("table", { name: "Things" });
    expect(table).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Name" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "alpha" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "5x" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2
  });

  it("shows the empty text when there is no data", () => {
    renderTable({ data: [] });

    expect(screen.getByText("Nothing here.")).toBeInTheDocument();
  });

  it("shows loading instead of empty text while loading, and marks the table busy", () => {
    renderTable({ data: undefined, isLoading: true });

    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText("Nothing here.")).not.toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");
  });

  it("disables Previous/Next according to the paging flags", () => {
    renderTable({ hasPrevious: false, hasNext: true });

    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("calls the paging callbacks", async () => {
    const user = userEvent.setup();
    const { onPrevious, onNext } = renderTable({
      hasPrevious: true,
      hasNext: true,
    });

    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Previous" }));

    expect(onNext).toHaveBeenCalledOnce();
    expect(onPrevious).toHaveBeenCalledOnce();
  });
});
