import { HydrationBoundary } from "@tanstack/react-query";

import { buildListTasksInput } from "@/modules/tasks/lib/list-tasks-input";
import type { TaskSearchParams } from "@/modules/tasks/lib/task-search-params";
import { PendingTasks } from "@/modules/tasks/ui/PendingTasks";
import { TaskList } from "@/modules/tasks/ui/TaskList";
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
