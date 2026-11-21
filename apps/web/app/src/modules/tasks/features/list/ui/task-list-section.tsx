import { HydrationBoundary } from "@tanstack/react-query";

import { buildListTasksInput } from "@/modules/tasks/features/list/lib/list-tasks-input";
import type { TaskSearchParams } from "@/modules/tasks/features/list/lib/task-search-params";
import { PendingTasks } from "@/modules/tasks/features/list/ui/pending-tasks";
import { TaskList } from "@/modules/tasks/features/list/ui/task-list";
import { TasksService } from "@/shared/api/connect/client";
import { createRpcPrefetcher } from "@/shared/api/connect/prefetch";

/** The task list, prefetched on the server (see DashboardStatsSection). */
export async function TaskListSection({
  params,
}: {
  params: TaskSearchParams;
}) {
  const prefetcher = createRpcPrefetcher();
  await prefetcher.prefetch(
    TasksService.method.listTasks,
    buildListTasksInput(params),
  );

  return (
    <>
      <PendingTasks />
      <HydrationBoundary state={prefetcher.dehydrate()}>
        <TaskList />
      </HydrationBoundary>
    </>
  );
}
