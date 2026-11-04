import { CLIENT_HEADER, CLIENT_ID } from "@/shared/api/connect/client-id";

// The upstream timeout bounds only the wait for response headers; once they
// arrive a stream (server-streaming RPC) may legitimately run for minutes, so
// from then on only silence between chunks is limited.
const HEADERS_TIMEOUT_MS = 15_000;
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
function upstreamHeaders(
  request: Request,
  accessToken: string | undefined,
): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }
  // Set last, so whatever the page sent under these names is overridden.
  headers.set(CLIENT_HEADER, CLIENT_ID);
  if (accessToken) {
    headers.set("authorization", `Bearer ${accessToken}`);
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

export type UpstreamCall = {
  fetch: typeof fetch;
  /** `<API_BASE_URL>/<procedure>`. */
  url: string;
  /** The browser's request: its allowlisted headers and its abort signal. */
  request: Request;
  body: ArrayBuffer;
  accessToken: string | undefined;
};

/**
 * One POST to apps/server with the bearer attached. The bearer never follows
 * a redirect (`redirect: "error"`), a closed tab aborts the call, the wait for
 * headers is bounded and a stalled stream is cut by `withIdleTimeout`.
 */
export async function forwardUpstream(call: UpstreamCall): Promise<Response> {
  const controller = new AbortController();
  // A closed tab must not keep a (streaming) RPC open with the bearer attached.
  const { signal } = call.request;
  if (signal.aborted) {
    controller.abort();
  } else {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  const headersTimer = setTimeout(() => controller.abort(), HEADERS_TIMEOUT_MS);
  try {
    const upstream = await call.fetch(call.url, {
      method: "POST",
      headers: upstreamHeaders(call.request, call.accessToken),
      body: call.body,
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    return withIdleTimeout(upstream, controller);
  } finally {
    clearTimeout(headersTimer);
  }
}
