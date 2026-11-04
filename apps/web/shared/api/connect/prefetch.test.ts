import {
  createConnectQueryKey,
  createQueryOptions,
} from "@connectrpc/connect-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createBrowserTransport } from "@/shared/api/connect/client";
import { TasksService } from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";
import { createRpcPrefetcher } from "@/shared/api/connect/prefetch";
import { getServerTransport } from "@/shared/api/connect/server";
import { fakeJwt } from "@/test/jwt";
import {
  rpcErrorHandler,
  rpcHandler,
  TEST_API_ORIGIN,
} from "@/test/mocks/connect";
import { server } from "@/test/mocks/server";

const jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name) } : undefined,
  }),
}));

beforeEach(() => jar.clear());

describe("server transport", () => {
  it("carries the same static key as the browser transport — the hydration contract", () => {
    const input = { pageSize: 20 };
    const serverKey = createQueryOptions(TasksService.method.listTasks, input, {
      transport: getServerTransport(),
    }).queryKey;
    const browserKey = createQueryOptions(
      TasksService.method.listTasks,
      input,
      {
        transport: createBrowserTransport(),
      },
    ).queryKey;

    expect(serverKey).toEqual(browserKey);
    expect(serverKey).toEqual(
      createConnectQueryKey({
        schema: TasksService.method.listTasks,
        input,
        transport: createBrowserTransport("http://elsewhere"),
        cardinality: "finite",
      }),
    );
  });
});

describe("createRpcPrefetcher", () => {
  it("prefetches with the caller's bearer token and dehydrates the result", async () => {
    const token = fakeJwt({ expiresInSeconds: 600 });
    jar.set("aedst_session", token);
    let seenAuth: string | null = null;
    server.use(
      rpcHandler(
        TasksService.method.getTaskStats,
        (_input, request) => {
          seenAuth = request.headers.get("authorization");
          return { total: 9 };
        },
        TEST_API_ORIGIN,
      ),
    );

    const prefetcher = createRpcPrefetcher();
    await prefetcher.prefetch(TasksService.method.getTaskStats, {});
    const { queries } = prefetcher.dehydrate();

    expect(seenAuth).toBe(`Bearer ${token}`);
    expect(queries).toHaveLength(1);
    expect(queries[0]?.state.data).toMatchObject({ total: 9 });
  });

  it("swallows a failed prefetch: nothing is dehydrated, the client will retry", async () => {
    jar.set("aedst_session", fakeJwt({ expiresInSeconds: 600 }));
    server.use(
      rpcErrorHandler(
        TasksService.method.getTaskStats,
        "internal",
        "boom",
        TEST_API_ORIGIN,
      ),
    );

    const prefetcher = createRpcPrefetcher();
    await expect(
      prefetcher.prefetch(TasksService.method.getTaskStats, {}),
    ).resolves.toBeUndefined();

    expect(prefetcher.dehydrate().queries).toEqual([]);
  });

  it("sends no Authorization header when signed out", async () => {
    let seenAuth: string | null = "unset";
    server.use(
      rpcHandler(
        TasksService.method.getTaskStats,
        (_input, request) => {
          seenAuth = request.headers.get("authorization");
          return {};
        },
        TEST_API_ORIGIN,
      ),
    );

    await createRpcPrefetcher().prefetch(TasksService.method.getTaskStats, {});

    expect(seenAuth).toBeNull();
  });
});
