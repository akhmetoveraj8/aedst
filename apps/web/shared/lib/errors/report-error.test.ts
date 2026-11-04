import { Code, ConnectError } from "@connectrpc/connect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => {
  const scope = {
    setTag: vi.fn(),
    setContext: vi.fn(),
    setFingerprint: vi.fn(),
  };
  return {
    scope,
    captureException: vi.fn(() => "event-id"),
    withScope: vi.fn((callback: (s: typeof scope) => unknown) =>
      callback(scope),
    ),
  };
});
vi.mock("@sentry/nextjs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sentry/nextjs")>()),
  captureException: sentry.captureException,
  withScope: sentry.withScope,
}));

import { reportError } from "@/shared/lib/errors/report-error";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reportError", () => {
  it("reports server faults with consistent tags and a per-procedure fingerprint", () => {
    const error = new ConnectError("db down", Code.Internal);
    expect(
      reportError(error, {
        source: "query",
        procedure: "aedst.tasks.v1.TasksService/GetTask",
        feature: "tasks",
        extra: { attempt: 2 },
      }),
    ).toBe("event-id");
    expect(sentry.scope.setTag).toHaveBeenCalledWith("error.kind", "unknown");
    expect(sentry.scope.setTag).toHaveBeenCalledWith("error.source", "query");
    expect(sentry.scope.setTag).toHaveBeenCalledWith("rpc.code", "Internal");
    expect(sentry.scope.setTag).toHaveBeenCalledWith(
      "rpc.procedure",
      "aedst.tasks.v1.TasksService/GetTask",
    );
    expect(sentry.scope.setTag).toHaveBeenCalledWith("feature", "tasks");
    expect(sentry.scope.setFingerprint).toHaveBeenCalledWith([
      "{{ default }}",
      "aedst.tasks.v1.TasksService/GetTask",
      "Internal",
    ]);
    expect(sentry.captureException).toHaveBeenCalledWith(error);
  });

  it("drops expected failures (definitive answers) but always reports render crashes", () => {
    const notFound = new ConnectError("gone", Code.NotFound);
    expect(reportError(notFound, { source: "mutation" })).toBeUndefined();
    expect(sentry.captureException).not.toHaveBeenCalled();

    reportError(notFound, { source: "route", componentStack: "at X" });
    expect(sentry.scope.setContext).toHaveBeenCalledWith("react", {
      componentStack: "at X",
    });
    expect(sentry.captureException).toHaveBeenCalledWith(notFound);
  });
});
