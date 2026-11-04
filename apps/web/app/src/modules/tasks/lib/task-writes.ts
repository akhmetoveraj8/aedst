import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { Client } from "@connectrpc/connect";

import type { TasksService } from "@/shared/api/connect/client";
import { parseDateInputValue } from "@/shared/date/format-date";

/**
 * The task writes that can be queued offline. Payloads are plain JSON of the
 * user's own form input - no tokens, no identity (they sit unencrypted in
 * IndexedDB until delivered).
 */
export type TaskCreatePayload = {
  title: string;
  description: string;
  priority: number;
  /** `yyyy-mm-dd` from the date input, or absent. */
  dueDate?: string;
};

export type TaskUpdatePayload = TaskCreatePayload & { taskId: string };

type TasksClient = Client<typeof TasksService>;

/** The header apps/server de-duplicates on (the outbox item id). */
function idempotent(idempotencyKey: string) {
  return { headers: { "Idempotency-Key": idempotencyKey } };
}

function due(payload: TaskCreatePayload) {
  return payload.dueDate
    ? timestampFromDate(parseDateInputValue(payload.dueDate))
    : undefined;
}

export function sendTaskCreate(
  client: TasksClient,
  idempotencyKey: string,
  payload: TaskCreatePayload,
) {
  return client.createTask(
    {
      title: payload.title,
      description: payload.description,
      priority: payload.priority,
      dueDate: due(payload),
    },
    idempotent(idempotencyKey),
  );
}

export function sendTaskUpdate(
  client: TasksClient,
  idempotencyKey: string,
  payload: TaskUpdatePayload,
) {
  return client.updateTask(
    {
      id: payload.taskId,
      title: payload.title,
      description: payload.description,
      priority: payload.priority,
      dueDate: due(payload),
      updateMask: {
        paths: ["title", "description", "priority", "due_date"],
      },
    },
    idempotent(idempotencyKey),
  );
}

function parseRecord(raw: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function toCreate(value: Record<string, unknown>) {
  return typeof value.title === "string" &&
    typeof value.description === "string" &&
    typeof value.priority === "number" &&
    (value.dueDate === undefined || typeof value.dueDate === "string")
    ? (value as TaskCreatePayload)
    : undefined;
}

/** Parses a queued create payload; `undefined` when malformed. */
export function parseCreatePayload(raw: string): TaskCreatePayload | undefined {
  const value = parseRecord(raw);
  return value && toCreate(value);
}

export function parseUpdatePayload(raw: string): TaskUpdatePayload | undefined {
  const value = parseRecord(raw);
  const base = value && toCreate(value);
  return base && typeof value?.taskId === "string"
    ? { ...base, taskId: value.taskId }
    : undefined;
}
