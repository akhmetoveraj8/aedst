"use client";

import { useTranslations } from "next-intl";
import { useCreateTask } from "@/modules/tasks/lib/use-task-writes";
import { TaskForm, type TaskFormValues } from "@/modules/tasks/ui/TaskForm";
import { TaskPriority } from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";
import { Link, useRouter } from "@/shared/i18n/navigation";
import { track } from "@/shared/lib/analytics/analytics";
import { toAppError } from "@/shared/lib/errors/app-error";
import { buttonVariants } from "@/shared/ui/button";

export function CreateTaskPage() {
  const t = useTranslations("tasks");
  const router = useRouter();
  const createTask = useCreateTask();

  function handleSubmit(values: TaskFormValues) {
    createTask.mutate(
      {
        title: values.title,
        description: values.description,
        priority: values.priority,
        dueDate: values.dueDate || undefined,
      },
      {
        onSuccess: (result) => {
          track("task_created", {
            priority: TaskPriority[values.priority] ?? "UNKNOWN",
            has_due_date: Boolean(values.dueDate),
          });
          // A queued task has no server id yet: the list shows it as pending.
          router.push(
            result.status === "sent" && result.value.task
              ? `/tasks/${result.value.task.id}`
              : "/tasks",
          );
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/tasks"
        className={buttonVariants({ variant: "ghost", className: "w-fit" })}
      >
        {t("details.backToList")}
      </Link>
      <h1 className="font-semibold text-xl">{t("form.createTitle")}</h1>
      <TaskForm
        mode="create"
        onSubmit={handleSubmit}
        isSubmitting={createTask.isPending}
        submitErrorKind={
          createTask.error ? toAppError(createTask.error).kind : undefined
        }
      />
    </div>
  );
}
