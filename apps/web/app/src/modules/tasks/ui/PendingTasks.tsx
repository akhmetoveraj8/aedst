"use client";

import { useTranslations } from "next-intl";

import { PRIORITY_KEYS } from "@/modules/tasks/lib/labels";
import { useQueuedTasks } from "@/modules/tasks/lib/use-task-writes";
import type { TaskPriority } from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";
import { useOutbox } from "@/shared/lib/outbox/OutboxProvider";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

/**
 * Tasks created while offline that the outbox has not delivered yet (or
 * gave up on). They have no server id, so they are listed here, above the
 * server list, until delivery replaces them with the real rows.
 */
export function PendingTasks() {
  const t = useTranslations("tasks.sync");
  const tPriority = useTranslations("tasks.priority");
  const outbox = useOutbox();
  const { creates } = useQueuedTasks();

  if (creates.length === 0) {
    return null;
  }

  return (
    <section
      aria-labelledby="pending-tasks-title"
      className="flex flex-col gap-2"
    >
      <h2 id="pending-tasks-title" className="font-medium text-sm">
        {t("queuedTitle")}
      </h2>
      <ul className="flex flex-col gap-2">
        {creates.map(({ id, status, payload }) => {
          const priorityKey = PRIORITY_KEYS[payload.priority as TaskPriority];
          return (
            <li
              key={id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-3"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{payload.title}</span>
                <span className="text-muted-foreground text-xs">
                  {priorityKey ? tPriority(priorityKey) : ""}
                  {status === "pending" ? ` · ${t("queuedHint")}` : ""}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={status === "failed" ? "destructive" : "secondary"}
                >
                  {status === "failed" ? t("failedBadge") : t("pendingBadge")}
                </Badge>
                {status === "failed" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void outbox?.remove(id)}
                  >
                    {t("discard")}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
