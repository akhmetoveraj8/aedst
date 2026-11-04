import {
  type DeliveryOutcome,
  MAX_ATTEMPTS,
  type OutboxEvent,
  type OutboxHandler,
  type OutboxRecord,
  type OutboxStore,
  type RunResult,
} from "@/shared/lib/outbox/types";

export type Outbox = {
  /**
   * Persists the operation and returns its id (also its idempotency key).
   * An id that already exists is ignored, so a double submit queues once.
   */
  enqueue(input: {
    type: string;
    payload: unknown;
    id?: string;
  }): Promise<string>;
  /** Delivers pending items in order; concurrent calls share one run. */
  run(): Promise<RunResult>;
  list(): Promise<OutboxRecord[]>;
  /** Discards one item (e.g. a parked one the user gave up on). */
  remove(id: string): Promise<void>;
  /** Drops this account's queue (sign-out). */
  clear(): Promise<void>;
  subscribe(listener: (event: OutboxEvent) => void): () => void;
};

export type OutboxOptions = {
  store: OutboxStore;
  /** Resolved lazily, at the first delivery, so unused feature code is not loaded. */
  handlers: () => Promise<ReadonlyMap<string, OutboxHandler>>;
  /** Account the queue belongs to; items of other accounts are dropped. */
  owner: string;
};

export function createOutbox({
  store,
  handlers,
  owner,
}: OutboxOptions): Outbox {
  const listeners = new Set<(event: OutboxEvent) => void>();
  const emit = (event: OutboxEvent) => {
    for (const listener of listeners) {
      listener(event);
    }
  };
  // Items left behind by another account on this browser are never sent.
  const ready = store.clear(owner);
  let running: Promise<RunResult> | undefined;

  async function deliver(
    handler: OutboxHandler,
    item: OutboxRecord,
  ): Promise<DeliveryOutcome> {
    try {
      return await handler.deliver({
        idempotencyKey: item.id,
        payload: item.payload,
      });
    } catch {
      // Handlers report expected failures as outcomes; a throw is a bug.
      return "permanent";
    }
  }

  async function park(item: OutboxRecord, attempts = item.attempts) {
    await store.update(item.id, { status: "failed", attempts });
    emit({ kind: "parked", id: item.id });
  }

  async function runOnce(): Promise<RunResult> {
    await ready;
    let delivered = 0;
    // One event per drain (not per item) tells listeners server data changed.
    const finish = (result: RunResult): RunResult => {
      if (delivered > 0) {
        emit({ kind: "drained", delivered });
      }
      return result;
    };
    for (;;) {
      const item = (await store.list(owner)).find(
        (candidate) => candidate.status === "pending",
      );
      if (!item) {
        return finish("complete");
      }
      const handler = (await handlers()).get(item.type);
      if (!handler) {
        await park(item);
        continue;
      }
      const outcome = await deliver(handler, item);
      if (outcome === "ok") {
        await store.remove(item.id);
        delivered += 1;
        emit({ kind: "delivered", id: item.id });
      } else if (outcome === "permanent") {
        await park(item);
      } else if (item.attempts + 1 >= MAX_ATTEMPTS) {
        await park(item);
      } else {
        await store.update(item.id, { attempts: item.attempts + 1 });
        return finish("retry");
      }
    }
  }

  return {
    async enqueue({ type, payload, id = crypto.randomUUID() }) {
      await ready;
      const added = await store.add({
        id,
        type,
        payload: JSON.stringify(payload),
        owner,
      });
      if (added) {
        emit({ kind: "enqueued", id });
      }
      return id;
    },
    run() {
      running ??= runOnce().finally(() => {
        running = undefined;
      });
      return running;
    },
    async list() {
      await ready;
      return await store.list(owner);
    },
    async remove(id) {
      await store.remove(id);
      emit({ kind: "removed" });
    },
    async clear() {
      await store.clear();
      emit({ kind: "cleared" });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
