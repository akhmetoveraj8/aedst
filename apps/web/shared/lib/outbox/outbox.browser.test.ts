import { afterEach, describe, expect, it } from "vitest";

import { createIdbOutboxStore } from "@/shared/lib/outbox/idb-store";
import { createOutbox } from "@/shared/lib/outbox/outbox";
import type { OutboxHandler } from "@/shared/lib/outbox/types";

const names: string[] = [];

afterEach(async () => {
  for (const name of names.splice(0)) {
    indexedDB.deleteDatabase(name);
  }
});

function open(name: string, owner = "user-1", handlers: OutboxHandler[] = []) {
  return createOutbox({
    store: createIdbOutboxStore(name),
    owner,
    handlers: async () => new Map(handlers.map((h) => [h.type, h])),
  });
}

function freshName() {
  const name = `outbox-test-${crypto.randomUUID()}`;
  names.push(name);
  return name;
}

describe("outbox on IndexedDB", () => {
  it("survives a reload: a new instance sees the queued items in order", async () => {
    const name = freshName();
    const first = open(name);
    await first.enqueue({ id: "a", type: "t", payload: { n: 1 } });
    await first.enqueue({ id: "b", type: "t", payload: { n: 2 } });

    const reopened = open(name);

    expect((await reopened.list()).map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("stores the payload as JSON and the id as the idempotency key", async () => {
    const name = freshName();
    const seen: Array<{ key: string; payload: string }> = [];
    const outbox = open(name, "user-1", [
      {
        type: "t",
        async deliver({ idempotencyKey, payload }) {
          seen.push({ key: idempotencyKey, payload });
          return "ok";
        },
      },
    ]);
    const id = await outbox.enqueue({ type: "t", payload: { title: "x" } });

    await outbox.run();

    expect(seen).toEqual([{ key: id, payload: '{"title":"x"}' }]);
  });

  it("emits one 'drained' event per run, however many items were delivered", async () => {
    const outbox = open(freshName(), "user-1", [
      { type: "t", deliver: async () => "ok" },
    ]);
    const events: string[] = [];
    outbox.subscribe((event) => events.push(event.kind));
    await outbox.enqueue({ id: "a", type: "t", payload: {} });
    await outbox.enqueue({ id: "b", type: "t", payload: {} });
    await outbox.enqueue({ id: "c", type: "t", payload: {} });
    events.length = 0;

    await outbox.run();
    await outbox.run(); // nothing left: no event

    expect(events.filter((kind) => kind === "delivered")).toHaveLength(3);
    expect(events.filter((kind) => kind === "drained")).toHaveLength(1);
  });

  it("drops another account's items and never delivers them", async () => {
    const name = freshName();
    const delivered: string[] = [];
    const handler: OutboxHandler = {
      type: "t",
      async deliver({ idempotencyKey }) {
        delivered.push(idempotencyKey);
        return "ok";
      },
    };
    await open(name, "alice", [handler]).enqueue({
      id: "alices",
      type: "t",
      payload: {},
    });

    const bob = open(name, "bob", [handler]);
    await bob.run();

    expect(delivered).toEqual([]);
    expect(await bob.list()).toEqual([]);
  });

  it("clear() empties the queue and notifies; remove() drops one parked item", async () => {
    const outbox = open(freshName());
    const events: string[] = [];
    outbox.subscribe((event) => events.push(event.kind));
    await outbox.enqueue({ id: "a", type: "unknown", payload: {} });
    await outbox.enqueue({ id: "b", type: "unknown", payload: {} });
    await outbox.run();
    expect((await outbox.list()).map((i) => i.status)).toEqual([
      "failed",
      "failed",
    ]);

    await outbox.remove("a");
    expect((await outbox.list()).map((i) => i.id)).toEqual(["b"]);

    await outbox.clear();
    expect(await outbox.list()).toEqual([]);
    expect(events).toEqual([
      "enqueued",
      "enqueued",
      "parked",
      "parked",
      "removed",
      "cleared",
    ]);
  });

  it("treats a throwing handler as a permanent failure", async () => {
    const outbox = open(freshName(), "user-1", [
      {
        type: "t",
        async deliver() {
          throw new Error("bug");
        },
      },
    ]);
    await outbox.enqueue({ id: "a", type: "t", payload: {} });

    expect(await outbox.run()).toBe("complete");
    expect((await outbox.list())[0]).toMatchObject({
      status: "failed",
      attempts: 0,
    });
  });

  it("shares one run between concurrent callers", async () => {
    let calls = 0;
    const outbox = open(freshName(), "user-1", [
      {
        type: "t",
        async deliver() {
          calls += 1;
          return "ok";
        },
      },
    ]);
    await outbox.enqueue({ id: "a", type: "t", payload: {} });

    await Promise.all([outbox.run(), outbox.run(), outbox.run()]);

    expect(calls).toBe(1);
  });
});
