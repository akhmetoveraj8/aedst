import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { backoffMs, startDelivery } from "@/shared/lib/outbox/delivery";
import type { Outbox } from "@/shared/lib/outbox/outbox";
import type { OutboxEvent, RunResult } from "@/shared/lib/outbox/types";

function fakeOutbox(results: RunResult[]) {
  const listeners = new Set<(event: OutboxEvent) => void>();
  const run = vi.fn(async () => results.shift() ?? "complete");
  const outbox = {
    run,
    subscribe(listener: (event: OutboxEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as Outbox;
  return {
    outbox,
    run,
    enqueued: () => {
      for (const listener of listeners) {
        listener({ kind: "enqueued", id: "x" });
      }
    },
  };
}

function fakeEnv(online = true) {
  const handlers: Record<string, () => void> = {};
  const state = { online, visible: true };
  return {
    state,
    env: {
      isOnline: () => state.online,
      isVisible: () => state.visible,
      on: (event: "online" | "visibilitychange", listener: () => void) => {
        handlers[event] = listener;
        return () => delete handlers[event];
      },
    },
    fire: (event: "online" | "visibilitychange") => handlers[event]?.(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("backoffMs", () => {
  it("doubles up to a cap, with jitter in the upper half", () => {
    expect(backoffMs(0, () => 0)).toBe(1_000);
    expect(backoffMs(0, () => 1)).toBe(2_000);
    expect(backoffMs(3, () => 1)).toBe(16_000);
    expect(backoffMs(30, () => 1)).toBe(300_000);
  });
});

describe("startDelivery", () => {
  it("runs at start and on every enqueue", async () => {
    const { outbox, run, enqueued } = fakeOutbox([]);
    const { env } = fakeEnv();
    startDelivery(outbox, env, () => 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);

    enqueued();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not run while offline, and runs when the browser comes online", async () => {
    const { outbox, run } = fakeOutbox([]);
    const { env, state, fire } = fakeEnv(false);
    startDelivery(outbox, env, () => 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).not.toHaveBeenCalled();

    state.online = true;
    fire("online");
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs when the tab becomes visible, not when it is hidden", async () => {
    const { outbox, run } = fakeOutbox([]);
    const { env, state, fire } = fakeEnv();
    startDelivery(outbox, env, () => 0);
    await vi.advanceTimersByTimeAsync(0);

    state.visible = false;
    fire("visibilitychange");
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);

    state.visible = true;
    fire("visibilitychange");
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("backs off after a retry run: enqueue is ignored until the timer, online cuts it short", async () => {
    const { outbox, run, enqueued } = fakeOutbox([
      "retry",
      "retry",
      "complete",
    ]);
    const { env, fire } = fakeEnv();
    startDelivery(outbox, env, () => 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);

    enqueued();
    await vi.advanceTimersByTimeAsync(500);
    expect(run).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(600); // 1 s elapsed: first backoff
    expect(run).toHaveBeenCalledTimes(2);

    fire("online");
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("stops everything on cleanup", async () => {
    const { outbox, run, enqueued } = fakeOutbox(["retry"]);
    const { env } = fakeEnv();
    const stop = startDelivery(outbox, env, () => 0);
    await vi.advanceTimersByTimeAsync(0);
    stop();

    enqueued();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
