import { afterEach, describe, expect, it, vi } from "vitest";

import { withIdleTimeout } from "./upstream";

function responseOf(body: ReadableStream<Uint8Array>) {
  return new Response(body, { status: 200 });
}

function chunks(...parts: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(encoder.encode(part));
      }
      controller.close();
    },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("withIdleTimeout", () => {
  it("aborts the upstream when it falls silent", async () => {
    vi.useFakeTimers();
    const silent = new ReadableStream<Uint8Array>({ start() {} });
    const controller = new AbortController();
    const wrapped = withIdleTimeout(responseOf(silent), controller, 50);

    const read = wrapped.body?.getReader().read();
    const settled = expect(read).rejects.toThrow(/idle/);
    await vi.advanceTimersByTimeAsync(60);

    await settled;
    expect(controller.signal.aborted).toBe(true);
  });

  it("does not count a slow consumer as an idle upstream", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const wrapped = withIdleTimeout(
      responseOf(chunks("a", "b", "c")),
      controller,
      50,
    );
    const reader = wrapped.body?.getReader();

    expect((await reader?.read())?.done).toBe(false);
    // The client stalls for far longer than the idle limit while the upstream
    // has data ready: nothing may be aborted.
    await vi.advanceTimersByTimeAsync(500);
    expect(controller.signal.aborted).toBe(false);

    const rest: string[] = [];
    const decoder = new TextDecoder();
    for (;;) {
      const next = await reader?.read();
      if (!next || next.done) {
        break;
      }
      rest.push(decoder.decode(next.value));
    }
    expect(rest.join("")).toBe("bc");
    expect(controller.signal.aborted).toBe(false);
  });
});
