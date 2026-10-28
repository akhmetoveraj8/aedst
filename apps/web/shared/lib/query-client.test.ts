import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it, vi } from "vitest";

import {
  isUnauthenticated,
  makeQueryClient,
  procedureFromKey,
} from "@/shared/lib/query-client";

const unauthenticated = new ConnectError("expired", Code.Unauthenticated);
const notFound = new ConnectError("gone", Code.NotFound);
const unavailable = new ConnectError("down", Code.Unavailable);

describe("isUnauthenticated", () => {
  it("recognises only Connect Unauthenticated errors", () => {
    expect(isUnauthenticated(unauthenticated)).toBe(true);
    expect(isUnauthenticated(notFound)).toBe(false);
    expect(isUnauthenticated(new Error("boom"))).toBe(false);
    expect(isUnauthenticated(undefined)).toBe(false);
  });
});

describe("makeQueryClient", () => {
  it("reports a lapsed session from queries", async () => {
    const onUnauthenticated = vi.fn();
    const client = makeQueryClient({ onUnauthenticated });

    await client
      .fetchQuery({
        queryKey: ["q"],
        queryFn: () => Promise.reject(unauthenticated),
        retry: false,
      })
      .catch(() => {});

    expect(onUnauthenticated).toHaveBeenCalledOnce();
  });

  it("reports a lapsed session from mutations instead of toasting", async () => {
    const onUnauthenticated = vi.fn();
    const onUserFacingError = vi.fn();
    const client = makeQueryClient({ onUnauthenticated, onUserFacingError });

    await client
      .getMutationCache()
      .build(client, { mutationFn: () => Promise.reject(unauthenticated) })
      .execute(undefined)
      .catch(() => {});

    expect(onUnauthenticated).toHaveBeenCalledOnce();
    expect(onUserFacingError).not.toHaveBeenCalled();
  });

  it("surfaces other mutation errors as user-facing, classified", async () => {
    const onUserFacingError = vi.fn();
    const client = makeQueryClient({ onUserFacingError });

    await client
      .getMutationCache()
      .build(client, { mutationFn: () => Promise.reject(unavailable) })
      .execute(undefined)
      .catch(() => {});

    expect(onUserFacingError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "unavailable", cause: unavailable }),
    );
  });

  it("stays quiet for mutations that render their own error (meta.silent)", async () => {
    const onUserFacingError = vi.fn();
    const client = makeQueryClient({ onUserFacingError });

    await client
      .getMutationCache()
      .build(client, {
        meta: { silent: true },
        mutationFn: () => Promise.reject(unavailable),
      })
      .execute(undefined)
      .catch(() => {});

    expect(onUserFacingError).not.toHaveBeenCalled();
  });

  it("does not retry definitive client errors but retries transient ones twice", () => {
    const retry = makeQueryClient().getDefaultOptions().queries?.retry as (
      failureCount: number,
      error: Error,
    ) => boolean;

    expect(retry(0, unauthenticated)).toBe(false);
    expect(retry(0, notFound)).toBe(false);
    expect(retry(0, unavailable)).toBe(true);
    expect(retry(1, unavailable)).toBe(true);
    expect(retry(2, unavailable)).toBe(false);
  });

  it("keeps a first-load query failure in the component, but announces a failed background refetch", async () => {
    const onUserFacingError = vi.fn();
    const client = makeQueryClient({ onUserFacingError });

    await client
      .fetchQuery({
        queryKey: ["first"],
        queryFn: () => Promise.reject(unavailable),
        retry: false,
      })
      .catch(() => {});
    expect(onUserFacingError).not.toHaveBeenCalled();

    client.setQueryData(["loaded"], { ok: true });
    await client
      .fetchQuery({
        queryKey: ["loaded"],
        queryFn: () => Promise.reject(unavailable),
        retry: false,
        staleTime: 0,
      })
      .catch(() => {});
    expect(onUserFacingError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "unavailable" }),
    );
  });
});

describe("procedureFromKey", () => {
  it("reads the procedure out of a connect-query key", () => {
    expect(
      procedureFromKey([
        "connect-query",
        { serviceName: "aedst.tasks.v1.TasksService", methodName: "GetTask" },
      ]),
    ).toBe("aedst.tasks.v1.TasksService/GetTask");
    expect(procedureFromKey(["other"])).toBeUndefined();
    expect(procedureFromKey(undefined)).toBeUndefined();
  });
});
