import type { OutboxHandler } from "@/shared/lib/outbox/types";

/**
 * Where feature modules contribute offline-outbox handlers. Each module
 * exports its handlers from `outbox.ts` and lists their types in its
 * manifest `outbox`; registry.test.ts keeps the two in step. Loaded lazily
 * (and only when an item is actually delivered), so a module's code does
 * not weigh on the first load.
 */
const loaders: ReadonlyArray<() => Promise<readonly OutboxHandler[]>> = [
  async () => (await import("@/modules/tasks/outbox")).tasksOutboxHandlers,
];

export async function loadOutboxHandlers(): Promise<OutboxHandler[]> {
  return (await Promise.all(loaders.map((load) => load()))).flat();
}
