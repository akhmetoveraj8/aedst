import { HydrationBoundary } from "@tanstack/react-query";

import { buildListTasksInput } from "@/modules/tasks/lib/list-tasks-input";
import type { TaskSearchParams } from "@/modules/tasks/lib/task-search-params";
import { DashboardStats } from "@/modules/tasks/ui/DashboardStats";
import { PendingTasks } from "@/modules/tasks/ui/PendingTasks";
import { TaskDetails } from "@/modules/tasks/ui/TaskDetails";
import { TaskList } from "@/modules/tasks/ui/TaskList";
import { TasksService } from "@/shared/api/connect/client";
import { createRpcPrefetcher } from "@/shared/api/connect/prefetch";
import { LoadingSkeleton } from "@/shared/ui/loading-skeleton";
import { Skeleton } from "@/shared/ui/skeleton";

/*
 * Server Components that prefetch on the server and hand the result to the
 * client component through `HydrationBoundary` — the reference pattern for
 * server data in this app (see `createRpcPrefetcher`). Render each inside
 * its own <Suspense> so a slow section streams in without blocking the rest.
 */

export async function DashboardStatsSection() {
  const prefetcher = createRpcPrefetcher();
  await prefetcher.prefetch(TasksService.method.getTaskStats, {});

  return (
    <HydrationBoundary state={prefetcher.dehydrate()}>
      <DashboardStats />
    </HydrationBoundary>
  );
}

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

export async function TaskDetailsSection({ taskId }: { taskId: string }) {
  const prefetcher = createRpcPrefetcher();
  await prefetcher.prefetch(TasksService.method.getTask, { id: taskId });

  return (
    <HydrationBoundary state={prefetcher.dehydrate()}>
      <TaskDetails taskId={taskId} />
    </HydrationBoundary>
  );
}

export function DashboardStatsFallback() {
  return (
    <LoadingSkeleton className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </LoadingSkeleton>
  );
}

export function TaskListFallback() {
  return (
    <LoadingSkeleton className="flex flex-col gap-2">
      <Skeleton className="h-9 w-full max-w-xs" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </LoadingSkeleton>
  );
}

export function TaskDetailsFallback() {
  return <LoadingSkeleton className="h-64 w-full max-w-lg" />;
}
