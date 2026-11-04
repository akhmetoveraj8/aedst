"use client";

import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useQuery } from "@connectrpc/connect-query";
import { keepPreviousData } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import { useCursorPages } from "@/modules/admin/lib/use-cursor-pages";
import { type AdminColumn, DataTable } from "@/modules/admin/ui/DataTable";
import { AdminService } from "@/shared/api/connect/client";
import type { AdminTask } from "@/shared/api/connect/generated/aedst/admin/v1/admin_pb";
import { TaskStatus } from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";
import { formatDate } from "@/shared/date/format-date";
import { useDebouncedValue } from "@/shared/lib/hooks/use-debounced-value";
import { Button } from "@/shared/ui/button";
import { Field, FieldLabel } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";

const PAGE_SIZE = 25;

// The dialog (Dialog stack, React Hook Form, Protovalidate) is needed only after
// "Delete" is clicked, so it loads on demand and then stays mounted.
const AdminDeleteTaskDialog = dynamic(() =>
  import("@/modules/admin/ui/AdminDeleteTaskDialog").then(
    (m) => m.AdminDeleteTaskDialog,
  ),
);

const STATUS_KEYS: Partial<Record<number, "todo" | "inProgress" | "done">> = {
  [TaskStatus.TODO]: "todo",
  [TaskStatus.IN_PROGRESS]: "inProgress",
  [TaskStatus.DONE]: "done",
};

/** Every user's tasks (cross-tenant read) with delete-with-reason (audited). */
export function AdminTasks() {
  const t = useTranslations("admin.tasks");
  const locale = useLocale();
  const searchId = useId();
  const pages = useCursorPages();
  const query = useDebouncedValue(pages.query.trim(), 300);
  const [deleting, setDeleting] = useState<{
    task: AdminTask;
    open: boolean;
  } | null>(null);

  const tasks = useQuery(
    AdminService.method.listTasks,
    { query, pageSize: PAGE_SIZE, pageToken: pages.pageToken },
    { placeholderData: keepPreviousData, meta: { feature: "admin" } },
  );

  const columns = useMemo<AdminColumn<AdminTask>[]>(
    () => [
      { accessorKey: "title", header: t("taskTitle") },
      {
        id: "owner",
        header: t("owner"),
        cell: ({ row }) => (
          <code className="text-xs">{row.original.ownerId.slice(0, 8)}</code>
        ),
      },
      {
        id: "status",
        header: t("status"),
        cell: ({ row }) => {
          const key = STATUS_KEYS[row.original.status];
          return key ? t(`statuses.${key}`) : "—";
        },
      },
      {
        id: "createdAt",
        header: t("createdAt"),
        cell: ({ row }) =>
          row.original.createdAt
            ? formatDate(timestampDate(row.original.createdAt), locale)
            : "—",
      },
      {
        id: "actions",
        header: () => <span className="sr-only">{t("actions")}</span>,
        cell: ({ row }) => (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setDeleting({ task: row.original, open: true })}
          >
            {t("delete")}
          </Button>
        ),
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
        data={tasks.data?.tasks}
        isLoading={tasks.isFetching}
        emptyText={tasks.isError ? t("loadError") : t("empty")}
        hasPrevious={pages.hasPrevious}
        hasNext={Boolean(tasks.data?.nextPageToken)}
        onPrevious={pages.previous}
        onNext={() => pages.next(tasks.data?.nextPageToken ?? "")}
      />
      {deleting && (
        <AdminDeleteTaskDialog
          task={deleting.task}
          open={deleting.open}
          onClose={() => setDeleting({ ...deleting, open: false })}
        />
      )}
    </div>
  );
}
