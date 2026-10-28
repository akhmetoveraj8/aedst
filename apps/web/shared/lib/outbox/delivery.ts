import type { Outbox } from "@/shared/lib/outbox/outbox";

const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 5 * 60_000;

/** Exponential backoff with jitter after `retries` consecutive retry runs. */
export function backoffMs(retries: number, random = Math.random): number {
  const ceiling = Math.min(BASE_DELAY_MS * 2 ** retries, MAX_DELAY_MS);
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

type Environment = {
  isOnline: () => boolean;
  isVisible: () => boolean;
  on: (
    event: "online" | "visibilitychange",
    listener: () => void,
  ) => () => void;
};

const browserEnvironment: Environment = {
  isOnline: () => navigator.onLine,
  isVisible: () => document.visibilityState === "visible",
  on(event, listener) {
    const target = event === "online" ? window : document;
    target.addEventListener(event, listener);
    return () => target.removeEventListener(event, listener);
  },
};

/**
 * Triggers delivery: once at start, on every enqueue, when the browser comes
 * back online and when the tab becomes visible again. After a `retry` run
 * it waits out an exponential backoff - enqueue and visibility triggers are
 * ignored meanwhile (they would hammer a failing server); `online` cuts the
 * wait short because connectivity is exactly what was missing.
 *
 * Background Sync is deliberately not used: the service worker
 * (src/app/sw.ts) has no sync handler and Safari/Firefox lack the API.
 * Returns the cleanup function.
 */
export function startDelivery(
  outbox: Outbox,
  env: Environment = browserEnvironment,
  random: () => number = Math.random,
): () => void {
  let retries = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  async function attempt() {
    if (stopped || !env.isOnline()) {
      return;
    }
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    const result = await outbox.run().catch(() => "retry" as const);
    if (stopped) {
      return;
    }
    if (result === "retry") {
      timer = setTimeout(
        () => {
          timer = undefined;
          void attempt();
        },
        backoffMs(retries, random),
      );
      retries += 1;
    } else {
      retries = 0;
    }
  }

  const trigger = () => {
    if (timer === undefined) {
      void attempt();
    }
  };

  const offEnqueue = outbox.subscribe((event) => {
    if (event.kind === "enqueued") {
      trigger();
    }
  });
  const offOnline = env.on("online", () => {
    retries = 0;
    void attempt();
  });
  const offVisible = env.on("visibilitychange", () => {
    if (env.isVisible()) {
      trigger();
    }
  });
  trigger();

  return () => {
    stopped = true;
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    offEnqueue();
    offOnline();
    offVisible();
  };
}
