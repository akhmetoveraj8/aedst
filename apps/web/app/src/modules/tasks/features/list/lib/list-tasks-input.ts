import type { MessageInitShape } from "@bufbuild/protobuf";

import type { TaskSearchParams } from "@/modules/tasks/lib/task-search-params";
import {
  type ListTasksRequestSchema,
  SortDirection,
  TaskPriority,
  TaskSortField,
  TaskStatus,
} from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";

export const TASKS_PAGE_SIZE = 20;

const STATUS_BY_FILTER = {
  todo: TaskStatus.TODO,
  "in-progress": TaskStatus.IN_PROGRESS,
  done: TaskStatus.DONE,
} as const;

const PRIORITY_BY_FILTER = {
  low: TaskPriority.LOW,
  medium: TaskPriority.MEDIUM,
  high: TaskPriority.HIGH,
  urgent: TaskPriority.URGENT,
} as const;

export const SORT_OPTIONS = [
  {
    value: "created-desc",
    sortBy: TaskSortField.CREATED_AT,
    sortDirection: SortDirection.DESC,
    labelKey: "sortCreatedDesc",
  },
  {
    value: "created-asc",
    sortBy: TaskSortField.CREATED_AT,
    sortDirection: SortDirection.ASC,
    labelKey: "sortCreatedAsc",
  },
  {
    value: "due-asc",
    sortBy: TaskSortField.DUE_DATE,
    sortDirection: SortDirection.ASC,
    labelKey: "sortDueAsc",
  },
  {
    value: "due-desc",
    sortBy: TaskSortField.DUE_DATE,
    sortDirection: SortDirection.DESC,
    labelKey: "sortDueDesc",
  },
] as const;

/**
 * The single place URL state becomes a `ListTasks` request. The Server
 * Component prefetch and the client `useQuery` both call this, so their
 * query keys are identical and hydration actually hits the cache.
 */
export function buildListTasksInput(
  params: TaskSearchParams,
): MessageInitShape<typeof ListTasksRequestSchema> {
  const sort =
    SORT_OPTIONS.find((option) => option.value === params.sort) ??
    SORT_OPTIONS[0];

  return {
    statuses: params.status === "all" ? [] : [STATUS_BY_FILTER[params.status]],
    priorities:
      params.priority === "all" ? [] : [PRIORITY_BY_FILTER[params.priority]],
    search: params.q,
    sortBy: sort.sortBy,
    sortDirection: sort.sortDirection,
    pageSize: TASKS_PAGE_SIZE,
    pageToken: params.cursors.at(-1) ?? "",
  };
}
