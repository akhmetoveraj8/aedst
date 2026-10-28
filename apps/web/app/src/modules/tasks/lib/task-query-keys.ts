import { createConnectQueryKey } from "@connectrpc/connect-query";

import { TasksService } from "@/shared/api/connect/client";

/**
 * Prefix of every TasksService query (a task, the list, the dashboard stats):
 * what a task write invalidates, instead of the whole cache.
 */
export function tasksQueryKey() {
  return createConnectQueryKey({
    schema: TasksService,
    cardinality: undefined,
  });
}
