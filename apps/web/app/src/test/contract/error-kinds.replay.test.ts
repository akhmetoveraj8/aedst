import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type AppError,
  type AppErrorKind,
  isRetryable,
  shouldReport,
  toAppError,
} from "@/shared/lib/errors/app-error";
import contract from "../../../../../../docs/contract/behavior/error-kinds.json";

/**
 * Replays docs/contract/behavior/error-kinds.json: the shared error vocabulary,
 * the Connect code -> kind table and the retryable/reportable flags. Android,
 * Apple and Desktop replay the same file against their own error types.
 */
type Case = {
  id: string;
  code?: string;
  reason?: string;
  transport?: "offline" | "timeout" | "aborted" | "storage";
  expect: { kind: string; retryable: boolean; reportable: boolean };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A google.rpc.ErrorInfo detail carrying only `reason` (field 1), as connect-go sends it. */
function withReason(error: ConnectError, reason: string) {
  const text = new TextEncoder().encode(reason);
  error.details.push({
    type: "google.rpc.ErrorInfo",
    value: new Uint8Array([0x0a, text.length, ...text]),
  });
  return error;
}

function failureFor(c: Case): unknown {
  switch (c.transport) {
    case "offline":
      vi.stubGlobal("navigator", { ...navigator, onLine: false });
      return new TypeError("Failed to fetch");
    case "timeout":
      return new DOMException("x", "TimeoutError");
    case "aborted":
      return new DOMException("x", "AbortError");
    case "storage":
      return undefined;
    default: {
      const name = (c.code ?? "")
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join("");
      const code = Code[name as keyof typeof Code];
      if (code === undefined) {
        throw new Error(`fixture ${c.id}: unknown Connect code ${c.code}`);
      }
      const error = new ConnectError("diagnostic", code);
      return c.reason ? withReason(error, c.reason) : error;
    }
  }
}

describe("error-kinds contract", () => {
  it("knows every kind the fixture declares, with no extras", () => {
    // Compile-time list: a kind added to the fixture or the type alone fails here.
    const kinds: Record<AppErrorKind, true> = {
      unauthenticated: true,
      forbidden: true,
      notFound: true,
      invalidInput: true,
      conflict: true,
      rateLimited: true,
      unavailable: true,
      offline: true,
      timeout: true,
      cancelled: true,
      upgradeRequired: true,
      storage: true,
      unknown: true,
    };
    expect(Object.keys(contract.kinds).sort()).toEqual(
      Object.keys(kinds).sort(),
    );
  });

  it.each(contract.cases as Case[])("$id", (c) => {
    const failure = failureFor(c);
    // Web has no local database failure source; the flags are still checked on the kind.
    const appError: AppError = failure
      ? toAppError(failure)
      : { kind: "storage", message: "", cause: undefined };
    expect({
      kind: appError.kind,
      retryable: isRetryable(appError),
      reportable: shouldReport(appError),
    }).toEqual(c.expect);
  });

  it.each(Object.entries(contract.kinds))(
    "kind %s carries the declared flags",
    (kind, flags) => {
      const appError: AppError = {
        kind: kind as AppErrorKind,
        message: "",
        cause: undefined,
      };
      expect(isRetryable(appError)).toBe(flags.retryable);
      expect(shouldReport(appError)).toBe(flags.reportable);
    },
  );
});
