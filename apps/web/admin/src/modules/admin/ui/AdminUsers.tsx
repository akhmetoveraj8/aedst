"use client";

import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useQuery } from "@connectrpc/connect-query";
import { keepPreviousData } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useId, useMemo } from "react";
import { useCursorPages } from "@/modules/admin/lib/use-cursor-pages";
import { type AdminColumn, DataTable } from "@/modules/admin/ui/DataTable";
import { AdminService } from "@/shared/api/connect/client";
import type { AdminUser } from "@/shared/api/connect/generated/aedst/admin/v1/admin_pb";
import { formatDate } from "@/shared/date/format-date";
import { useDebouncedValue } from "@/shared/lib/hooks/use-debounced-value";
import { Field, FieldLabel } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";

const PAGE_SIZE = 25;

export function AdminUsers() {
  const t = useTranslations("admin.users");
  const locale = useLocale();
  const searchId = useId();
  const pages = useCursorPages();
  const query = useDebouncedValue(pages.query.trim(), 300);

  const users = useQuery(
    AdminService.method.listUsers,
    { query, pageSize: PAGE_SIZE, pageToken: pages.pageToken },
    { placeholderData: keepPreviousData, meta: { feature: "admin" } },
  );

  const columns = useMemo<AdminColumn<AdminUser>[]>(
    () => [
      { accessorKey: "email", header: t("email") },
      { accessorKey: "displayName", header: t("name") },
      {
        id: "createdAt",
        header: t("createdAt"),
        cell: ({ row }) =>
          row.original.createdAt
            ? formatDate(timestampDate(row.original.createdAt), locale)
            : "—",
      },
      {
        id: "taskCount",
        header: t("tasks"),
        cell: ({ row }) => row.original.taskCount.toString(),
      },
    ],
    [t, locale],
  );

  return (
    <div className="flex flex-col gap-3">
      <Field className="max-w-sm">
        <FieldLabel htmlFor={searchId}>{t("search")}</FieldLabel>
        <Input
          id={searchId}
          type="search"
          value={pages.query}
          onChange={(event) => pages.setQuery(event.target.value)}
        />
      </Field>
      <DataTable
        label={t("title")}
        columns={columns}
        data={users.data?.users}
        isLoading={users.isFetching}
        emptyText={users.isError ? t("loadError") : t("empty")}
        hasPrevious={pages.hasPrevious}
        hasNext={Boolean(users.data?.nextPageToken)}
        onPrevious={pages.previous}
        onNext={() => pages.next(users.data?.nextPageToken ?? "")}
      />
    </div>
  );
}
