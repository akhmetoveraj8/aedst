import type { MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";

import {
  TaskPriority,
  type TaskSchema,
  TaskStatus,
} from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";

let counter = 0;

/** A task with sensible defaults; override only what the test cares about. */
export function makeTask(
  overrides: MessageInitShape<typeof TaskSchema> = {},
): MessageInitShape<typeof TaskSchema> {
  counter += 1;
  const id = `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
  return {
    id,
    title: `Task ${counter}`,
    description: "",
    status: TaskStatus.TODO,
    priority: TaskPriority.MEDIUM,
    createdAt: timestampFromDate(new Date("2026-01-15T10:00:00Z")),
    updatedAt: timestampFromDate(new Date("2026-01-16T10:00:00Z")),
    createdBy: "user-1",
    version: 1,
    ...overrides,
  };
}
