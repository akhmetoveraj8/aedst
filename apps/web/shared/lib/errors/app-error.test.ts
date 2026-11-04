import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  errorMessageKey,
  isRetryable,
  retryDelayMs,
  shouldReport,
  toAppError,
} from "@/shared/lib/errors/app-error";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("toAppError", () => {
  it.each([
    [Code.Unauthenticated, "unauthenticated"],
    [Code.PermissionDenied, "forbidden"],
    [Code.NotFound, "notFound"],
    [Code.InvalidArgument, "invalidInput"],
    [Code.AlreadyExists, "conflict"],
    [Code.Aborted, "conflict"],
    [Code.FailedPrecondition, "invalidInput"],
    [Code.ResourceExhausted, "rateLimited"],
    [Code.Unavailable, "unavailable"],
    [Code.DeadlineExceeded, "timeout"],
    [Code.Canceled, "cancelled"],
    [Code.Internal, "unknown"],
  ])("maps Connect code %s to %s", (code, kind) => {
    const error = toAppError(new ConnectError("diagnostic", code));
    expect(error.kind).toBe(kind);
    expect(error.message).toBe("diagnostic");
  });

  it("calls a transport failure while the browser is offline 'offline'", () => {
    vi.stubGlobal("navigator", { ...navigator, onLine: false });
    expect(toAppError(new ConnectError("x", Code.Unavailable)).kind).toBe(
      "offline",
    );
    expect(toAppError(new TypeError("Failed to fetch")).kind).toBe("offline");
  });

  it("classifies aborts and timeouts from AbortController / AbortSignal.timeout", () => {
    expect(toAppError(new DOMException("x", "AbortError")).kind).toBe(
      "cancelled",
    );
    expect(toAppError(new DOMException("x", "TimeoutError")).kind).toBe(
      "timeout",
    );
  });

  it("treats anything else as an unknown bug", () => {
    expect(toAppError(new Error("boom"))).toMatchObject({
      kind: "unknown",
      message: "boom",
    });
    expect(toAppError("weird").kind).toBe("unknown");
  });
});

describe("policies", () => {
  it("never retries definitive answers, retries transient failures", () => {
    expect(isRetryable(toAppError(new ConnectError("", Code.NotFound)))).toBe(
      false,
    );
    expect(
      isRetryable(toAppError(new ConnectError("", Code.PermissionDenied))),
    ).toBe(false);
    expect(
      isRetryable(toAppError(new ConnectError("", Code.Unavailable))),
    ).toBe(true);
    expect(
      isRetryable(toAppError(new ConnectError("", Code.ResourceExhausted))),
    ).toBe(true);
  });

  it("reports only bugs and storage faults", () => {
    expect(shouldReport(toAppError(new Error("bug")))).toBe(true);
    expect(
      shouldReport(toAppError(new ConnectError("", Code.Unavailable))),
    ).toBe(false);
    expect(
      shouldReport(toAppError(new ConnectError("", Code.InvalidArgument))),
    ).toBe(false);
  });

  it("backs off exponentially, longer for rate limits, and caps the wait", () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    const outage = toAppError(new ConnectError("", Code.Unavailable));
    const limited = toAppError(new ConnectError("", Code.ResourceExhausted));
    expect(retryDelayMs(0, outage)).toBe(500);
    expect(retryDelayMs(1, outage)).toBe(1_000);
    expect(retryDelayMs(0, limited)).toBe(2_000);
    expect(retryDelayMs(20, outage)).toBe(15_000);
  });

  it("names the translated message for each kind", () => {
    expect(errorMessageKey("rateLimited")).toBe("kinds.rateLimited");
  });
});
