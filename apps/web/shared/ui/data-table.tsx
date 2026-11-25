"use client";

import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  ArrowUpDownIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  type ColumnDef,
  createSortedRowModel,
  type RowData,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { cn } from "cn";

import { Button } from "@/shared/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";

/** Client-side sorting only; filtering and paging stay with the caller. */
const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns,
});

type DataTableColumn<TData extends RowData, TValue = unknown> = ColumnDef<
  typeof dataTableFeatures,
  TData,
  TValue
>;

const EMPTY: never[] = [];
const SORT_ICON = {
  asc: ArrowUp01Icon,
  desc: ArrowDown01Icon,
  none: ArrowUpDownIcon,
} as const;
const ARIA_SORT = {
  asc: "ascending",
  desc: "descending",
  none: "none",
} as const;

interface DataTableProps<TData extends RowData> {
  /** Accessible name of the table and of its scrollable region. */
  label: string;
  /** Define at module scope or memoize: a new array rebuilds the row model. */
  columns: DataTableColumn<TData>[];
  data: TData[] | undefined;
  /** Shown in the single body row while there are no rows. */
  emptyText: string;
  isLoading?: boolean;
  /** Replaces `emptyText` while `isLoading` and there are no rows. */
  loadingText?: string;
  className?: string;
}

/**
 * shadcn/ui data table: TanStack Table (headless) rendered with the kit's
 * `Table` primitives. Sortable columns get a header button and `aria-sort`;
 * set `enableSorting: false` on a column to opt out.
 */
function DataTable<TData extends RowData>({
  label,
  columns,
  data,
  emptyText,
  isLoading = false,
  loadingText,
  className,
}: DataTableProps<TData>) {
  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: data ?? (EMPTY as TData[]),
  });
  const rows = table.getRowModel().rows;

  return (
    <section
      data-slot="data-table"
      aria-label={label}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard reachable
      tabIndex={0}
      className={cn(
        "overflow-x-auto rounded-md border outline-none focus-visible:ring-3 focus-visible:ring-ring",
        className,
      )}
    >
      <Table aria-label={label} aria-busy={isLoading}>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => {
                const sortable = header.column.getCanSort();
                const sorted = header.column.getIsSorted() || "none";
                return (
                  <TableHead
                    key={header.id}
                    aria-sort={sortable ? ARIA_SORT[sorted] : undefined}
                  >
                    {header.isPlaceholder ? null : sortable ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="-ms-2.5"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <table.FlexRender header={header} />
                        <HugeiconsIcon
                          icon={SORT_ICON[sorted]}
                          strokeWidth={2}
                          data-icon="inline-end"
                          aria-hidden="true"
                        />
                      </Button>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-20 text-center text-muted-foreground"
              >
                {isLoading && loadingText ? loadingText : emptyText}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </section>
  );
}

export {
  DataTable,
  type DataTableColumn,
  type DataTableProps,
  dataTableFeatures,
};
