import { describe, expect, it } from "vitest";

import { readBoundedBody } from "@/app/api/rpc/read-bounded-body";

function chunked(chunks: Uint8Array[]): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  return new Request("http://localhost/api/rpc/x", {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit);
}

describe("readBoundedBody", () => {
  it("returns the bytes of a body within the limit", async () => {
    const body = await readBoundedBody(
      chunked([new Uint8Array([1, 2]), new Uint8Array([3])]),
      10,
    );
    expect(body && [...new Uint8Array(body)]).toEqual([1, 2, 3]);
  });

  it("rejects a chunked body that has no content-length once it exceeds the limit", async () => {
    const big = new Uint8Array(6);
    expect(await readBoundedBody(chunked([big, big]), 10)).toBeNull();
  });

  it("rejects a declared length over the limit without reading", async () => {
    const request = new Request("http://localhost/x", {
      method: "POST",
      body: "x",
      headers: { "content-length": "999" },
    });
    expect(await readBoundedBody(request, 10)).toBeNull();
  });

  it("treats a malformed content-length as unknown and counts the real bytes", async () => {
    const request = new Request("http://localhost/x", {
      method: "POST",
      body: "abc",
      headers: { "content-length": "NaN" },
    });
    const body = await readBoundedBody(request, 10);
    expect(body?.byteLength).toBe(3);
  });

  it("returns an empty buffer when there is no body", async () => {
    const body = await readBoundedBody(
      new Request("http://localhost/x", { method: "POST" }),
      10,
    );
    expect(body?.byteLength).toBe(0);
  });
});
