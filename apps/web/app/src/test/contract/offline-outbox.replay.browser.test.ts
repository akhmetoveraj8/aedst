import { afterEach, describe, expect, it } from "vitest";

import { createIdbOutboxStore } from "@/shared/lib/outbox/idb-store";
import { createOutbox } from "@/shared/lib/outbox/outbox";
import {
  type DeliveryOutcome,
  MAX_ATTEMPTS,
  type OutboxHandler,
} from "@/shared/lib/outbox/types";
import contract from "../../../../../../docs/contract/behavior/offline-outbox.json";

/**
 * Replays docs/contract/behavior/offline-outbox.json (the single source for
 * all platforms) against the real outbox engine on real IndexedDB.
 */
type Expectation = {
  result?: string;
  sent?: Array<{ id: string; idempotencyKey: string }>;
  queue?: Array<{ id: string; status: string; attempts: number }>;
};
type Step = {
  enqueue?: { id: string; type: string };
  run?: { outcomes: DeliveryOutcome[] };
  repeatRun?: number;
  expect?: Expectation;
};

const databases: string[] = [];

afterEach(async () => {
  for (const name of databases.splice(0)) {
    indexedDB.deleteDatabase(name);
  }
});

function harness() {
  const name = `outbox-contract-${crypto.randomUUID()}`;
  databases.push(name);
  let outcomes: DeliveryOutcome[] = [];
  let sent: Array<{ id: string; idempotencyKey: string }> = [];
  const handlers = new Map<string, OutboxHandler>(
    contract.knownTypes.map((type) => [
      type,
      {
        type,
        async deliver({ idempotencyKey }) {
          // The item id is the key; the fake echoes both so the case can compare.
          sent.push({ id: idempotencyKey, idempotencyKey });
          return outcomes.shift() ?? "ok";
        },
      },
    ]),
  );
  const outbox = createOutbox({
    store: createIdbOutboxStore(name),
    handlers: async () => handlers,
    owner: "user-1",
  });
  return {
    outbox,
    async run(next: DeliveryOutcome[]) {
      outcomes = [...next];
      sent = [];
      const result = await outbox.run();
      return { result, sent };
    },
  };
}

describe("offline-outbox contract", () => {
  it("uses the contract's attempt limit", () => {
    expect(MAX_ATTEMPTS).toBe(contract.maxAttempts);
  });

  it.each(contract.cases)("$id", async ({ steps }) => {
    const { outbox, run } = harness();

    for (const step of steps as Step[]) {
      if (step.enqueue) {
        await outbox.enqueue({
          id: step.enqueue.id,
          type: step.enqueue.type,
          payload: {},
        });
      }
      if (!step.run) {
        continue;
      }
      for (let i = 0; i < (step.repeatRun ?? 1); i++) {
        const { result, sent } = await run(step.run.outcomes);
        const expected = step.expect ?? {};
        if (expected.result !== undefined) {
          expect(result).toBe(expected.result);
        }
        if (expected.sent !== undefined) {
          expect(sent).toEqual(expected.sent);
        }
      }
      const expected = step.expect;
      if (expected?.queue !== undefined) {
        const queue = (await outbox.list()).map(({ id, status, attempts }) => ({
          id,
          status,
          attempts,
        }));
        expect(queue).toEqual(expected.queue);
      }
    }
  });
});
