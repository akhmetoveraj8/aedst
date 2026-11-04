"use client";

import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { createClient } from "@connectrpc/connect";
import { createConnectQueryKey, useTransport } from "@connectrpc/connect-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { tasksQueryKey } from "@/modules/tasks/lib/task-query-keys";
import {
  parseCreatePayload,
  parseUpdatePayload,
  sendTaskCreate,
  sendTaskUpdate,
  type TaskCreatePayload,
  type TaskUpdatePayload,
} from "@/modules/tasks/lib/task-writes";
import { TasksService } from "@/shared/api/connect/client";
import type { GetTaskResponse } from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";
import { mutationKeyFor } from "@/shared/api/connect/mutation-key";
import { parseDateInputValue } from "@/shared/date/format-date";
import { useOutboxItems } from "@/shared/lib/outbox/OutboxProvider";
import { useQueuedWrite } from "@/shared/lib/outbox/use-queued-write";

const META = { silent: true, feature: "tasks" } as const;

function useTasksClient() {
  const transport = useTransport();
  return useMemo(() => createClient(TasksService, transport), [transport]);
}

/**
 * Create a task online-first, queueing it in the offline outbox when the
 * network is down (see `useQueuedWrite`). Result `status: "queued"` has no
 * server id yet; the pending list shows it until it is delivered.
 */
export function useCreateTask() {
  const client = useTasksClient();
  const send = useCallback(
    (key: string, payload: TaskCreatePayload) =>
      sendTaskCreate(client, key, payload),
    [client],
  );
  const write = useQueuedWrite("task.create", send);
  return useMutation({
    mutationFn: write,
    mutationKey: mutationKeyFor(TasksService.method.createTask),
    meta: META,
  });
}

/**
 * Update a task with an optimistic cache patch: the detail view shows the
 * edit at once; a definitive rejection rolls it back, a queued write keeps
 * it (with the "pending sync" badge) until the outbox delivers it.
 */
export function useUpdateTask() {
  const client = useTasksClient();
  const transport = useTransport();
  const queryClient = useQueryClient();
  const send = useCallback(
    (key: string, payload: TaskUpdatePayload) =>
      sendTaskUpdate(client, key, payload),
    [client],
  );
  const write = useQueuedWrite("task.update", send);
  const keyFor = (taskId: string) =>
    createConnectQueryKey({
      schema: TasksService.method.getTask,
      input: { id: taskId },
      cardinality: "finite",
      transport,
    });

  return useMutation({
    mutationFn: write,
    mutationKey: mutationKeyFor(TasksService.method.updateTask),
    meta: META,
    onMutate: async (payload) => {
      const queryKey = keyFor(payload.taskId);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<GetTaskResponse>(queryKey);
      if (previous?.task) {
        queryClient.setQueryData<GetTaskResponse>(queryKey, {
          ...previous,
          task: {
            ...previous.task,
            title: payload.title,
            description: payload.description,
            priority: payload.priority,
            dueDate: payload.dueDate
              ? timestampFromDate(parseDateInputValue(payload.dueDate))
              : undefined,
          },
        });
      }
      return { previous, queryKey };
    },
    onError: (_error, _payload, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.queryKey, context.previous);
      }
    },
    onSuccess: (result) => {
      // Sent: the server's truth replaces the patch. Queued: keep the patch,
      // a refetch offline would only fail (the outbox refetches on delivery).
      if (result.status === "sent") {
        return queryClient.invalidateQueries({ queryKey: tasksQueryKey() });
      }
    },
  });
}

/** Queued task writes, parsed for display. */
export function useQueuedTasks() {
  const items = useOutboxItems();
  return useMemo(() => {
    const creates = items.flatMap((item) => {
      const payload =
        item.type === "task.create" ? parseCreatePayload(item.payload) : null;
      return payload ? [{ id: item.id, status: item.status, payload }] : [];
    });
    const updates = items.flatMap((item) => {
      const payload =
        item.type === "task.update" ? parseUpdatePayload(item.payload) : null;
      return payload ? [{ id: item.id, status: item.status, payload }] : [];
    });
    return { creates, updates };
  }, [items]);
}
