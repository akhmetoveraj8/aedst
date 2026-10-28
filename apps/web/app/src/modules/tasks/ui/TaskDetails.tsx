"use client";

import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { useMutation, useQuery } from "@connectrpc/connect-query";
import { useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { tasksQueryKey } from "@/modules/tasks/lib/task-query-keys";
import {
  useQueuedTasks,
  useUpdateTask,
} from "@/modules/tasks/lib/use-task-writes";
import { PriorityBadge } from "@/modules/tasks/ui/PriorityBadge";
import { StatusBadge } from "@/modules/tasks/ui/StatusBadge";
import type {
  SettablePriority,
  TaskFormValues,
} from "@/modules/tasks/ui/TaskForm";
import { TasksService } from "@/shared/api/connect/client";
import { TaskStatus } from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";
import { mutationKeyFor } from "@/shared/api/connect/mutation-key";
import {
  formatDate,
  formatDateInputValue,
  formatDateTime,
} from "@/shared/date/format-date";
import { Link, useRouter } from "@/shared/i18n/navigation";
import { track } from "@/shared/lib/analytics/analytics";
import { errorMessageKey, toAppError } from "@/shared/lib/errors/app-error";
import { Badge } from "@/shared/ui/badge";
import { Button, buttonVariants } from "@/shared/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/ui/empty";
import { LoadingSkeleton } from "@/shared/ui/loading-skeleton";
import { Skeleton } from "@/shared/ui/skeleton";

// The edit form (and the Select stack it needs) is only used after "Edit", so
// it stays out of the details route's first load.
const DeleteTaskDialog = dynamic(() =>
  import("@/modules/tasks/ui/DeleteTaskDialog").then((m) => m.DeleteTaskDialog),
);

const TaskForm = dynamic(
  () => import("@/modules/tasks/ui/TaskForm").then((m) => m.TaskForm),
  { loading: () => <Skeleton className="h-64 w-full" /> },
);

function toDateInputValue(date: Date | undefined) {
  return date ? formatDateInputValue(date) : "";
}

export function TaskDetails({ taskId }: { taskId: string }) {
  const t = useTranslations("tasks.details");
  const tForm = useTranslations("tasks.form");
  const tList = useTranslations("tasks.list");
  const tSync = useTranslations("tasks.sync");
  const tErrors = useTranslations("common.errors");
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery(
    TasksService.method.getTask,
    { id: taskId },
  );

  // This task, the list and the dashboard stats can all change from any of
  // these actions, so every TasksService query is invalidated (not the whole
  // cache: other modules' data is unaffected; the outbox provider owns the
  // global refetch after a drain).
  function invalidateAll() {
    return queryClient.invalidateQueries({ queryKey: tasksQueryKey() });
  }

  // These mutations render their own inline error below, so they opt out of
  // the global error toast (`meta.silent`).
  const updateTask = useUpdateTask();
  const { updates } = useQueuedTasks();
  const syncStatus = updates.find((u) => u.payload.taskId === taskId)?.status;
  const completeTask = useMutation(TasksService.method.completeTask, {
    mutationKey: mutationKeyFor(TasksService.method.completeTask),
    meta: { silent: true, feature: "tasks" },
    onSuccess: () => {
      track("task_completed");
      return invalidateAll();
    },
  });
  const reopenTask = useMutation(TasksService.method.reopenTask, {
    mutationKey: mutationKeyFor(TasksService.method.reopenTask),
    meta: { silent: true, feature: "tasks" },
    onSuccess: invalidateAll,
  });
  const deleteTask = useMutation(TasksService.method.deleteTask, {
    mutationKey: mutationKeyFor(TasksService.method.deleteTask),
    meta: { silent: true, feature: "tasks" },
    onSuccess: () => {
      void invalidateAll();
      router.push("/tasks");
    },
  });

  if (isLoading) {
    return <LoadingSkeleton className="h-64 w-full max-w-lg" />;
  }

  // A missing/foreign task is a "not found"; anything else (network, server
  // error) is a load failure the user can retry — not the same message.
  const isMissing =
    !isError || (error instanceof ConnectError && error.code === Code.NotFound);

  if (isError || !data?.task) {
    return (
      <Empty role={isMissing ? undefined : "alert"}>
        <EmptyHeader>
          <EmptyTitle>
            {isMissing ? t("notFoundTitle") : t("loadErrorTitle")}
          </EmptyTitle>
          {isMissing && (
            <EmptyDescription>{t("notFoundDescription")}</EmptyDescription>
          )}
        </EmptyHeader>
        {!isMissing && (
          <EmptyContent>
            <Button variant="outline" onClick={() => refetch()}>
              {tList("retry")}
            </Button>
          </EmptyContent>
        )}
      </Empty>
    );
  }

  const task = data.task;
  // The server's text is diagnostic English: the user sees the translated
  // kind, and the mutation cache already sent the raw error to Sentry.
  const actionError =
    updateTask.error ??
    completeTask.error ??
    reopenTask.error ??
    deleteTask.error;

  if (isEditing) {
    return (
      <TaskForm
        mode="edit"
        defaultValues={{
          title: task.title,
          description: task.description,
          priority: task.priority as SettablePriority,
          dueDate: toDateInputValue(
            task.dueDate ? timestampDate(task.dueDate) : undefined,
          ),
        }}
        isSubmitting={updateTask.isPending}
        onCancel={() => setIsEditing(false)}
        submitErrorKind={
          updateTask.error ? toAppError(updateTask.error).kind : undefined
        }
        onSubmit={(values: TaskFormValues) =>
          updateTask.mutate(
            {
              taskId: task.id,
              title: values.title,
              description: values.description,
              priority: values.priority,
              dueDate: values.dueDate || undefined,
            },
            { onSuccess: () => setIsEditing(false) },
          )
        }
      />
    );
  }

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <Link
        href="/tasks"
        className={buttonVariants({ variant: "ghost", className: "w-fit" })}
      >
        {t("backToList")}
      </Link>

      <div className="flex items-start justify-between gap-3">
        <h1 className="font-semibold text-xl">{task.title}</h1>
        <div className="flex shrink-0 items-center gap-2">
          {syncStatus && (
            <Badge
              variant={syncStatus === "failed" ? "destructive" : "secondary"}
            >
              {syncStatus === "failed"
                ? tSync("failedBadge")
                : tSync("pendingBadge")}
            </Badge>
          )}
          <PriorityBadge priority={task.priority} />
          <StatusBadge status={task.status} />
        </div>
      </div>

      {task.description && (
        <p className="whitespace-pre-wrap text-muted-foreground">
          {task.description}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{t("dueDate")}</dt>
        <dd>
          {task.dueDate
            ? formatDate(timestampDate(task.dueDate), locale)
            : t("noDueDate")}
        </dd>
        <dt className="text-muted-foreground">{t("createdBy")}</dt>
        <dd>{t("you")}</dd>
        <dt className="text-muted-foreground">{t("createdAt")}</dt>
        <dd>
          {task.createdAt
            ? formatDateTime(timestampDate(task.createdAt), locale)
            : "—"}
        </dd>
        <dt className="text-muted-foreground">{t("updatedAt")}</dt>
        <dd>
          {task.updatedAt
            ? formatDateTime(timestampDate(task.updatedAt), locale)
            : "—"}
        </dd>
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => setIsEditing(true)}>
          {t("edit")}
        </Button>

        {task.status === TaskStatus.DONE ? (
          <Button
            variant="outline"
            onClick={() => reopenTask.mutate({ id: task.id })}
            disabled={reopenTask.isPending}
          >
            {t("reopen")}
          </Button>
        ) : (
          <Button
            onClick={() => completeTask.mutate({ id: task.id })}
            disabled={completeTask.isPending}
          >
            {t("complete")}
          </Button>
        )}

        <Button variant="destructive" onClick={() => setConfirmingDelete(true)}>
          {t("delete")}
        </Button>
        {confirmingDelete && (
          <DeleteTaskDialog
            open
            onOpenChange={setConfirmingDelete}
            onConfirm={() => deleteTask.mutate({ id: task.id })}
          />
        )}
      </div>

      {actionError && (
        <p role="alert" className="text-destructive text-sm">
          {tForm("error", {
            message: tErrors(errorMessageKey(toAppError(actionError).kind)),
          })}
        </p>
      )}
    </div>
  );
}
