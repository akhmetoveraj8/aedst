"use client";

import { useTranslations } from "next-intl";
import {
  ALL_PRIORITIES,
  ALL_STATUSES,
  PRIORITY_KEYS,
  STATUS_KEYS,
} from "@/modules/tasks/lib/labels";
import { SORT_OPTIONS } from "@/modules/tasks/lib/list-tasks-input";
import {
  PRIORITY_FILTERS,
  STATUS_FILTERS,
} from "@/modules/tasks/lib/task-search-params";
import {
  type TaskPriority,
  TaskStatus,
} from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";

type StatusFilter = (typeof STATUS_FILTERS)[number];
type PriorityFilter = (typeof PRIORITY_FILTERS)[number];
type SortValue = (typeof SORT_OPTIONS)[number]["value"];

const STATUS_FILTER_BY_ENUM = {
  [TaskStatus.TODO]: "todo",
  [TaskStatus.IN_PROGRESS]: "in-progress",
  [TaskStatus.DONE]: "done",
} as const;

const PRIORITY_FILTER_BY_ENUM = {
  1: "low",
  2: "medium",
  3: "high",
  4: "urgent",
} as const;

/**
 * The status / priority / sort selects of the task list. Split out of
 * `TaskList` so the base-ui Select stack loads as its own chunk (see
 * `TaskListFiltersSlot`), not with the route's first load.
 */
export function TaskListFilters({
  status,
  priority,
  sort,
  onStatusChange,
  onPriorityChange,
  onSortChange,
}: Readonly<{
  status: StatusFilter;
  priority: PriorityFilter;
  sort: SortValue;
  onStatusChange: (value: StatusFilter) => void;
  onPriorityChange: (value: PriorityFilter) => void;
  onSortChange: (value: SortValue) => void;
}>) {
  const t = useTranslations("tasks.list");
  const tStatus = useTranslations("tasks.status");
  const tPriority = useTranslations("tasks.priority");

  function statusLabel(value: TaskStatus) {
    const key = STATUS_KEYS[value];
    return key ? tStatus(key) : "";
  }

  function priorityLabel(value: TaskPriority) {
    const key = PRIORITY_KEYS[value];
    return key ? tPriority(key) : "";
  }

  return (
    <>
      <Select
        items={[
          { value: "all", label: t("allStatuses") },
          ...ALL_STATUSES.map((value) => ({
            value: STATUS_FILTER_BY_ENUM[value],
            label: statusLabel(value),
          })),
        ]}
        value={status}
        onValueChange={(value) => {
          if (STATUS_FILTERS.includes(value as StatusFilter)) {
            onStatusChange(value as StatusFilter);
          }
        }}
      >
        <SelectTrigger className="w-40" aria-label={t("statusFilterLabel")}>
          <SelectValue placeholder={t("allStatuses")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("allStatuses")}</SelectItem>
          {ALL_STATUSES.map((value) => (
            <SelectItem key={value} value={STATUS_FILTER_BY_ENUM[value]}>
              {statusLabel(value)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        items={[
          { value: "all", label: t("allPriorities") },
          ...ALL_PRIORITIES.map((value) => ({
            value: PRIORITY_FILTER_BY_ENUM[value],
            label: priorityLabel(value),
          })),
        ]}
        value={priority}
        onValueChange={(value) => {
          if (PRIORITY_FILTERS.includes(value as PriorityFilter)) {
            onPriorityChange(value as PriorityFilter);
          }
        }}
      >
        <SelectTrigger className="w-40" aria-label={t("priorityFilterLabel")}>
          <SelectValue placeholder={t("allPriorities")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("allPriorities")}</SelectItem>
          {ALL_PRIORITIES.map((value) => (
            <SelectItem key={value} value={PRIORITY_FILTER_BY_ENUM[value]}>
              {priorityLabel(value)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        items={SORT_OPTIONS.map((option) => ({
          value: option.value,
          label: t(option.labelKey),
        }))}
        value={sort}
        onValueChange={(value) => {
          const option = SORT_OPTIONS.find((o) => o.value === value);
          if (option) {
            onSortChange(option.value);
          }
        }}
      >
        <SelectTrigger className="w-48" aria-label={t("sortLabel")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {t(option.labelKey)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
