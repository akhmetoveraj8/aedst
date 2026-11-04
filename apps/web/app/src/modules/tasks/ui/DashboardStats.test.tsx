import { createQueryOptions } from "@connectrpc/connect-query";
import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from "@tanstack/react-query";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DashboardStats } from "@/modules/tasks/ui/DashboardStats";
import { TasksService } from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";
import { backend, Code, rpc, rpcError } from "@/test/mocks/transport";
import { messages, renderWithProviders } from "@/test/render";

const t = messages.tasks.dashboard;

function statValue(label: string) {
  const card = screen.getByText(label).closest("[data-slot='card']");
  return card as HTMLElement;
}

describe("DashboardStats", () => {
  it("shows each aggregate from a single GetTaskStats call", async () => {
    let calls = 0;
    backend.use(
      rpc(TasksService.method.getTaskStats, () => {
        calls += 1;
        return { total: 12, todo: 5, inProgress: 3, done: 4, overdue: 2 };
      }),
    );

    renderWithProviders(<DashboardStats />);

    expect(
      await within(statValue(t.totalTasks)).findByText("12"),
    ).toBeVisible();
    expect(within(statValue(t.todo)).getByText("5")).toBeVisible();
    expect(within(statValue(t.inProgress)).getByText("3")).toBeVisible();
    expect(within(statValue(t.completed)).getByText("4")).toBeVisible();
    expect(within(statValue(t.overdue)).getByText("2")).toBeVisible();
    expect(calls).toBe(1);
  });

  it("highlights overdue tasks only when there are some", async () => {
    backend.use(
      rpc(TasksService.method.getTaskStats, () => ({
        total: 1,
        todo: 1,
        overdue: 0,
      })),
    );

    renderWithProviders(<DashboardStats />);
    const overdue = await within(statValue(t.overdue)).findByText("0");

    expect(overdue.className).not.toContain("text-destructive");
  });

  it("marks overdue in the destructive colour when non-zero", async () => {
    backend.use(
      rpc(TasksService.method.getTaskStats, () => ({
        total: 3,
        overdue: 3,
      })),
    );

    renderWithProviders(<DashboardStats />);

    expect(
      (await within(statValue(t.overdue)).findByText("3")).className,
    ).toContain("text-destructive");
  });

  it("degrades to dashes when the request fails", async () => {
    backend.use(
      rpcError(TasksService.method.getTaskStats, Code.Internal, "boom"),
    );

    renderWithProviders(<DashboardStats />);

    expect(await within(statValue(t.totalTasks)).findByText("—")).toBeVisible();
  });

  it("renders server-prefetched data on first paint, before any client request", async () => {
    backend.use(rpc(TasksService.method.getTaskStats, () => ({ total: 7 })));
    // What a Server Component does (see createRpcPrefetcher): prefetch with a
    // transport carrying the shared static key, then dehydrate.
    const serverClient = new QueryClient();
    await serverClient.prefetchQuery(
      createQueryOptions(
        TasksService.method.getTaskStats,
        {},
        { transport: backend.transport },
      ),
    );

    renderWithProviders(
      <HydrationBoundary state={dehydrate(serverClient)}>
        <DashboardStats />
      </HydrationBoundary>,
    );

    // Synchronous `getBy…`: present immediately, i.e. the client's query key
    // matched the server's — no skeleton, no waiting for the network.
    expect(within(statValue(t.totalTasks)).getByText("7")).toBeVisible();
  });
});
