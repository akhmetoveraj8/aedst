import { HydrationBoundary } from "@tanstack/react-query";

import { TaskDetails } from "@/modules/tasks/features/details/ui/task-details";
import { TasksService } from "@/shared/api/connect/client";
import { createRpcPrefetcher } from "@/shared/api/connect/prefetch";

/** One task, prefetched on the server (see DashboardStatsSection). */
export async function TaskDetailsSection({ taskId }: { taskId: string }) {
  const prefetcher = createRpcPrefetcher();
  await prefetcher.prefetch(TasksService.method.getTask, { id: taskId });

  return (
    <HydrationBoundary state={prefetcher.dehydrate()}>
      <TaskDetails taskId={taskId} />
    </HydrationBoundary>
  );
}
