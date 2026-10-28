"use client";

import {
  type ColumnDef,
  type RowData,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useTranslations } from "next-intl";

import { Button } from "@/shared/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";

/** Core-only: sorting/filtering/paging are the server's job for admin lists. */
const adminTableFeatures = tableFeatures({});

export type AdminColumn<TData extends RowData> = ColumnDef<
  typeof adminTableFeatures,
  TData,
  unknown
>;

const EMPTY: never[] = [];

/**
 * TanStack Table (headless) rendered with the shared shadcn table
 * primitives, plus keyset "previous/next" controls. Columns must be
 * defined at module scope (or memoized) — a new array per render would
 * rebuild the row model every time.
 */
export function DataTable<TData extends RowData>({
  label,
  columns,
  data,
  isLoading,
  emptyText,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
}: {
  label: string;
  columns: AdminColumn<TData>[];
  data: TData[] | undefined;
  isLoading: boolean;
  emptyText: string;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const t = useTranslations("admin.table");
  const table = useTable({
    features: adminTableFeatures,
    columns,
    data: data ?? (EMPTY as TData[]),
  });
  const rows = table.getRowModel().rows;

  return (
    <div className="flex flex-col gap-3">
      {/* Scrollable region: focusable so keyboard users can scroll it. */}
      <section
        aria-label={label}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard reachable
        tabIndex={0}
        className="overflow-x-auto rounded-md border focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Table aria-label={label} aria-busy={isLoading}>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : (
                      <table.FlexRender header={header} />
                    )}
                  </TableHead>
                ))}
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
                  {isLoading ? t("loading") : emptyText}
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
      <nav aria-label={t("pagination")} className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!hasPrevious}
          onClick={onPrevious}
        >
          {t("previous")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasNext}
          onClick={onNext}
        >
          {t("next")}
        </Button>
      </nav>
    </div>
  );
}
