/**
 * Offline outbox: durable queue of writes made while offline (or flaky),
 * delivered in order with the item id as the `Idempotency-Key`. The
 * behaviour is specified once for every platform in
 * docs/contract/behavior/offline-outbox.json and replayed by
 * src/test/contract/offline-outbox.replay.browser.test.ts.
 */

/** Failed deliveries after which an item is parked (contract `maxAttempts`). */
export const MAX_ATTEMPTS = 8;

/** `pending` is still to be delivered; `failed` is parked and never retried. */
type OutboxStatus = "pending" | "failed";

export type OutboxRecord = {
  /** Also the `Idempotency-Key` of every delivery attempt of this item. */
  id: string;
  /** Selects the handler, e.g. `task.create`. */
  type: string;
  /**
   * JSON of the operation. Never put tokens, passwords or other secrets or
   * personal data beyond the user's own form input here: IndexedDB is not
   * encrypted (ADR-0013). The queue is cleared on sign-out.
   */
  payload: string;
  status: OutboxStatus;
  /** Failed delivery attempts so far. */
  attempts: number;
  /** Account the item belongs to; another account's items are never delivered. */
  owner: string;
  createdAt: number;
};

export type NewOutboxRecord = Pick<
  OutboxRecord,
  "id" | "type" | "payload" | "owner"
>;

/** FIFO persistence port. `IdbOutboxStore` is the real one. */
export type OutboxStore = {
  /** Appends the item; `false` (and no change) when the id already exists. */
  add(record: NewOutboxRecord): Promise<boolean>;
  /** Items of `owner`, oldest first. */
  list(owner: string): Promise<OutboxRecord[]>;
  update(
    id: string,
    patch: Partial<Pick<OutboxRecord, "status" | "attempts">>,
  ): Promise<void>;
  remove(id: string): Promise<void>;
  /** Drops every item that does not belong to `owner` (all, when omitted). */
  clear(keepOwner?: string): Promise<void>;
};

/** What a handler reports; mirrors the contract's run outcomes. */
export type DeliveryOutcome = "ok" | "retryable" | "permanent";

type OutboxDelivery = {
  /** Send as the `Idempotency-Key` header. */
  idempotencyKey: string;
  /** The enqueued JSON, unparsed (a malformed payload is the handler's `permanent`). */
  payload: string;
};

/**
 * Delivers one kind of queued operation. Contributed by feature modules
 * (module `public.ts` -> `src/app/config/modules/outbox-handlers.ts`); the
 * types a module owns are listed in its manifest `outbox`.
 */
export type OutboxHandler = {
  /** Unique across handlers, e.g. `task.create`. */
  type: string;
  deliver(delivery: OutboxDelivery): Promise<DeliveryOutcome>;
};

/** `complete`: nothing left to try now. `retry`: stopped on a retryable failure. */
export type RunResult = "complete" | "retry";

export type OutboxEvent =
  | { kind: "enqueued"; id: string }
  | { kind: "delivered"; id: string }
  /** A run that delivered at least one item has stopped (queue empty or backing off). */
  | { kind: "drained"; delivered: number }
  | { kind: "parked"; id: string }
  | { kind: "removed" }
  | { kind: "cleared" };
