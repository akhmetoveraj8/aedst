import { HydrationBoundary } from "@tanstack/react-query";

import { DashboardStats } from "@/modules/tasks/ui/DashboardStats";
import { TasksService } from "@/shared/api/connect/client";
import { createRpcPrefetcher } from "@/shared/api/connect/prefetch";

/*
 * Server Component that prefetches on the server and hands the result to the
 * client component through `HydrationBoundary`: the reference pattern for
 * server data in this app (see `createRpcPrefetcher`). Each section lives in
 * its own file so a page importing one does not pull the client chunks of
 * the others; render it inside its own <Suspense>.
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
