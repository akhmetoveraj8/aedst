"use client";

import { useCallback } from "react";
import { outcomeForError } from "@/shared/lib/outbox/classify";
import { useOutbox } from "@/shared/lib/outbox/OutboxProvider";

export type QueuedWriteResult<T> =
  | { status: "sent"; value: T }
  /** Saved on the device; the outbox delivers it when it can. */
  | { status: "queued"; id: string };

/**
 * Online-first write with the outbox as the safety net. The write is sent
 * at once with a fresh id as its idempotency key, so the user gets the
 * server's answer (and inline validation errors) when the network works.
 * When it does not (offline, timeout, 5xx, rate limit), the same id is
 * queued instead: the outbox's later delivery re-sends the same key, so a
 * request that did reach the server but lost its response is not applied
 * twice. A definitive rejection is thrown to the caller, never queued.
 *
 * Use as a TanStack `mutationFn` so `useMutation` supplies pending/error
 * state and optimistic updates.
 */
export function useQueuedWrite<Payload, Value>(
  type: string,
  send: (idempotencyKey: string, payload: Payload) => Promise<Value>,
) {
  const outbox = useOutbox();

  return useCallback(
    async (payload: Payload): Promise<QueuedWriteResult<Value>> => {
      const id = crypto.randomUUID();
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      let failure: unknown;
      if (!offline) {
        try {
          return { status: "sent", value: await send(id, payload) };
        } catch (error) {
          if (!outbox || outcomeForError(error) !== "retryable") {
            throw error;
          }
          failure = error;
        }
      }
      if (!outbox) {
        throw new Error("offline and no outbox available");
      }
      try {
        await outbox.enqueue({ id, type, payload });
      } catch {
        // The device store is unusable (private mode, quota): surface the
        // original failure rather than pretend the write is safe.
        throw failure ?? new Error("could not save the change on this device");
      }
      return { status: "queued", id };
    },
    [outbox, send, type],
  );
}
