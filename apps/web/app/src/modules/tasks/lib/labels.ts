import {
  TaskPriority,
  TaskStatus,
} from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";

export const STATUS_KEYS: Record<
  TaskStatus,
  "todo" | "inProgress" | "done" | null
> = {
  [TaskStatus.UNSPECIFIED]: null,
  [TaskStatus.TODO]: "todo",
  [TaskStatus.IN_PROGRESS]: "inProgress",
  [TaskStatus.DONE]: "done",
};

export const PRIORITY_KEYS: Record<
  TaskPriority,
  "low" | "medium" | "high" | "urgent" | null
> = {
  [TaskPriority.UNSPECIFIED]: null,
  [TaskPriority.LOW]: "low",
  [TaskPriority.MEDIUM]: "medium",
  [TaskPriority.HIGH]: "high",
  [TaskPriority.URGENT]: "urgent",
};

export const ALL_STATUSES = [
  TaskStatus.TODO,
  TaskStatus.IN_PROGRESS,
  TaskStatus.DONE,
] as const;
export const ALL_PRIORITIES = [
  TaskPriority.LOW,
  TaskPriority.MEDIUM,
  TaskPriority.HIGH,
  TaskPriority.URGENT,
] as const;

/**
 * Badge variants (design tokens, `shared/ui/badge.tsx`) per status/priority;
 * no palette classes in modules (`task check:colors`). Priority reads
 * secondary -> info -> warning -> destructive as it gets more urgent.
 */
export type TaskBadgeVariant =
  | "secondary"
  | "info"
  | "success"
  | "warning"
  | "destructive";

export const STATUS_BADGE_VARIANT: Record<TaskStatus, TaskBadgeVariant> = {
  [TaskStatus.UNSPECIFIED]: "secondary",
  [TaskStatus.TODO]: "secondary",
  [TaskStatus.IN_PROGRESS]: "info",
  [TaskStatus.DONE]: "success",
};

export const PRIORITY_BADGE_VARIANT: Record<TaskPriority, TaskBadgeVariant> = {
  [TaskPriority.UNSPECIFIED]: "secondary",
  [TaskPriority.LOW]: "secondary",
  [TaskPriority.MEDIUM]: "info",
  [TaskPriority.HIGH]: "warning",
  [TaskPriority.URGENT]: "destructive",
};
