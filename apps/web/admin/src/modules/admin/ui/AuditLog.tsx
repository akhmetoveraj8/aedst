"use client";

import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useQuery } from "@connectrpc/connect-query";
import { keepPreviousData } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { useCursorPages } from "@/modules/admin/lib/use-cursor-pages";
import { type AdminColumn, DataTable } from "@/modules/admin/ui/DataTable";
import { AdminService } from "@/shared/api/connect/client";
import type { AuditEntry } from "@/shared/api/connect/generated/aedst/admin/v1/admin_pb";
import { formatDateTime } from "@/shared/date/format-date";

const PAGE_SIZE = 50;

/** Append-only record of every admin mutation, newest first. */
export function AuditLog() {
  const t = useTranslations("admin.audit");
  const locale = useLocale();
  const pages = useCursorPages();
  const log = useQuery(
    AdminService.method.listAuditLog,
    { pageSize: PAGE_SIZE, pageToken: pages.pageToken },
    { placeholderData: keepPreviousData, meta: { feature: "admin" } },
  );

  const columns = useMemo<AdminColumn<AuditEntry>[]>(
    () => [
      {
        id: "createdAt",
        header: t("when"),
        cell: ({ row }) =>
          row.original.createdAt
            ? formatDateTime(timestampDate(row.original.createdAt), locale)
            : "—",
      },
      {
        id: "actor",
        header: t("actor"),
        cell: ({ row }) => (
          <code className="text-xs">{row.original.actorId.slice(0, 8)}</code>
        ),
      },
      { accessorKey: "action", header: t("action") },
      {
        id: "target",
        header: t("target"),
        cell: ({ row }) =>
          `${row.original.targetKind}${row.original.targetId ? ` · ${row.original.targetId.slice(0, 8)}` : ""}`,
      },
      { accessorKey: "reason", header: t("reason") },
    ],
    [t, locale],
  );

  return (
    <DataTable
      label={t("title")}
      columns={columns}
      data={log.data?.entries}
      isLoading={log.isFetching}
      emptyText={log.isError ? t("loadError") : t("empty")}
      hasPrevious={pages.hasPrevious}
      hasNext={Boolean(log.data?.nextPageToken)}
      onPrevious={pages.previous}
      onNext={() => pages.next(log.data?.nextPageToken ?? "")}
    />
  );
}
