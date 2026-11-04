import { afterEach, describe, expect, it, vi } from "vitest";

import { forwardUpstream, withIdleTimeout } from "@/shared/lib/bff/upstream";

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

describe("forwardUpstream", () => {
  const call = (
    fetchImpl: typeof fetch,
    request = new Request("http://localhost/api/rpc/x", { method: "POST" }),
  ) =>
    forwardUpstream({
      fetch: fetchImpl,
      url: "http://api.test/x",
      request,
      body: new ArrayBuffer(0),
      accessToken: "at",
    });

  it("never lets the bearer follow a redirect", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}"));
    await call(fetchMock);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer at");
  });

  it("aborts the upstream call when the browser goes away", async () => {
    const client = new AbortController();
    let upstreamSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      upstreamSignal = init?.signal ?? undefined;
      return new Response("{}");
    });
    await call(
      fetchMock,
      new Request("http://localhost/api/rpc/x", {
        method: "POST",
        signal: client.signal,
      }),
    );
    expect(upstreamSignal?.aborted).toBe(false);
    client.abort();
    expect(upstreamSignal?.aborted).toBe(true);
  });
});
