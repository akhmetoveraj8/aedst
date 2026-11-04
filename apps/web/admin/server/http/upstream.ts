// The upstream timeout bounds only the wait for response headers; once they
// arrive a stream (server-streaming RPC) may legitimately run for minutes, so
// from then on only silence between chunks is limited.
export const HEADERS_TIMEOUT_MS = 15_000;
const STREAM_IDLE_TIMEOUT_MS = 60_000;

const FORWARDED_REQUEST_HEADERS = [
  "content-type",
  "accept",
  "connect-protocol-version",
  "connect-timeout-ms",
  "idempotency-key",
  // Trace propagation, so a browser span and the server's spans join up.
  "traceparent",
  "tracestate",
  "sentry-trace",
  "baggage",
];

const DROPPED_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "set-cookie",
]);

/** Only the allowlisted request headers, plus the client id and the bearer. */
export function upstreamHeaders(
  request: Request,
  extra: Record<string, string>,
): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }
  for (const [name, value] of Object.entries(extra)) {
    headers.set(name, value);
  }
  return headers;
}

/** Upstream response headers minus the hop-by-hop and cookie ones, uncached. */
export function clientHeaders(upstream: Response): Headers {
  const headers = new Headers();
  upstream.headers.forEach((value, name) => {
    if (!DROPPED_RESPONSE_HEADERS.has(name)) {
      headers.set(name, value);
    }
  });
  headers.set("cache-control", "no-store");
  return headers;
}

/** Re-wraps the body so a stalled upstream is aborted after the idle limit. */
export function withIdleTimeout(
  upstream: Response,
  controller: AbortController,
  idleMs: number = STREAM_IDLE_TIMEOUT_MS,
): Response {
  if (!upstream.body) {
    return upstream;
  }
  const reader = upstream.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sink: ReadableStreamDefaultController<Uint8Array> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      controller.abort();
      sink?.error(new Error("upstream stream idle"));
    }, idleMs);
  };
  const body = new ReadableStream<Uint8Array>({
    start(out) {
      sink = out;
    },
    async pull(out) {
      try {
        // Only silence from the upstream counts: the timer runs while we wait
        // for it, never while a slow consumer has not asked for more yet.
        arm();
        const { done, value } = await reader.read();
        clearTimeout(timer);
        if (done) {
          out.close();
          return;
        }
        out.enqueue(value);
      } catch (error) {
        clearTimeout(timer);
        out.error(error);
      }
    },
    async cancel(reason) {
      clearTimeout(timer);
      await reader.cancel(reason);
    },
  });
  return new Response(body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}
