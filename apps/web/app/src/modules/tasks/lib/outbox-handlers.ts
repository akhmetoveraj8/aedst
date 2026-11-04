import { createClient, type Transport } from "@connectrpc/connect";

import {
  parseCreatePayload,
  parseUpdatePayload,
  sendTaskCreate,
  sendTaskUpdate,
} from "@/modules/tasks/lib/task-writes";
import {
  transport as browserTransport,
  TasksService,
} from "@/shared/api/connect/client";
import { outcomeForError } from "@/shared/lib/outbox/classify";
import type { DeliveryOutcome, OutboxHandler } from "@/shared/lib/outbox/types";

/** Types match `outbox` in the module manifest (checked by registry.test.ts). */
const TASK_CREATE = "task.create";
const TASK_UPDATE = "task.update";

async function attempt(send: () => Promise<unknown>): Promise<DeliveryOutcome> {
  try {
    await send();
    return "ok";
  } catch (error) {
    return outcomeForError(error);
  }
}

export function createTaskOutboxHandlers(
  transport: Transport,
): OutboxHandler[] {
  const client = createClient(TasksService, transport);
  return [
    {
      type: TASK_CREATE,
      async deliver({ idempotencyKey, payload }) {
        const parsed = parseCreatePayload(payload);
        return parsed
          ? await attempt(() => sendTaskCreate(client, idempotencyKey, parsed))
          : "permanent";
      },
    },
    {
      type: TASK_UPDATE,
      async deliver({ idempotencyKey, payload }) {
        const parsed = parseUpdatePayload(payload);
        return parsed
          ? await attempt(() => sendTaskUpdate(client, idempotencyKey, parsed))
          : "permanent";
      },
    },
  ];
}

export const tasksOutboxHandlers = createTaskOutboxHandlers(browserTransport);
