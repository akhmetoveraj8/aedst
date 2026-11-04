"use client";

import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useLocale, useTranslations } from "next-intl";

import { PriorityBadge } from "@/modules/tasks/ui/PriorityBadge";
import { StatusBadge } from "@/modules/tasks/ui/StatusBadge";
import type { Task } from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";
import { formatDate } from "@/shared/date/format-date";
import { Link } from "@/shared/i18n/navigation";

/** One row of the task list: title, due date and the priority/status badges. */
export function TaskListRow({ task }: { task: Task }) {
  const t = useTranslations("tasks.list");
  const locale = useLocale();
  return (
    <li>
      <Link
        href={`/tasks/${task.id}`}
        className="flex items-center justify-between gap-3 rounded-lg border p-3 hover:bg-accent"
      >
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate font-medium">{task.title}</span>
          {task.dueDate && (
            <span className="text-muted-foreground text-xs">
              {t("due", {
                date: formatDate(timestampDate(task.dueDate), locale),
              })}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <PriorityBadge priority={task.priority} />
          <StatusBadge status={task.status} />
        </div>
      </Link>
    </li>
  );
}
