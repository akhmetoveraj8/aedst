import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";

import { loadTaskSearchParams } from "@/modules/tasks/lib/task-search-params";
import {
  DashboardStatsFallback,
  DashboardStatsSection,
  TaskDetailsFallback,
  TaskDetailsSection,
  TaskListFallback,
  TaskListSection,
} from "@/modules/tasks/ui/TasksSections";
import { TasksService } from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";
import { makeTask } from "@/test/fixtures";
import { backend, rpc } from "@/test/mocks/transport";
import { messages, renderWithProviders } from "@/test/render";

// The server prefetch (createRpcPrefetcher -> getServerTransport) is pointed at
// the in-memory Connect backend; the bearer/cookie handling of the real server
// transport is covered by prefetch.test.ts and the BFF route tests.
vi.mock("@/shared/api/connect/server", async () => {
  const { backend } = await import("@/test/mocks/transport");
  return { getServerTransport: () => backend.transport };
});

/**
 * Server Components can't render inside React Testing Library, but their
 * output can: `await` the component (this runs the real server prefetch
 * against the mocked API), then render the returned tree in the browser
 * providers — exactly what the RSC payload does on the client.
 */
describe("server sections", () => {
  it("DashboardStatsSection ships prefetched stats into the client component", async () => {
    backend.use(
      rpc(TasksService.method.getTaskStats, () => ({ total: 4, todo: 4 })),
    );

    const tree = await DashboardStatsSection();
    renderWithProviders(tree, { staleTime: Number.POSITIVE_INFINITY });

    // Present synchronously, and no client-origin handler exists in this test:
    // a refetch on mount would fail it (`onUnhandledRequest: "error"`).
    expect(screen.getByText(messages.tasks.dashboard.totalTasks)).toBeVisible();
    expect(screen.getAllByText("4").length).toBeGreaterThan(0);
  });

  it("TaskListSection prefetches the page the URL asks for", async () => {
    let seen: { pageToken?: string; search?: string } = {};
    backend.use(
      rpc(TasksService.method.listTasks, (input) => {
        seen = input;
        return { tasks: [makeTask({ title: "From the server" })] };
      }),
    );

    const tree = await TaskListSection({
      params: loadTaskSearchParams({ q: "srv", cursors: "tok" }),
    });
    renderWithProviders(tree, {
      searchParams: "?q=srv&cursors=tok",
      staleTime: Number.POSITIVE_INFINITY,
    });

    expect(seen).toMatchObject({ search: "srv", pageToken: "tok" });
    expect(screen.getByText("From the server")).toBeVisible();
  });

  it("TaskDetailsSection prefetches one task", async () => {
    const task = makeTask({ title: "Detail from server" });
    backend.use(rpc(TasksService.method.getTask, () => ({ task })));

    const tree = await TaskDetailsSection({ taskId: String(task.id) });
    renderWithProviders(tree, { staleTime: Number.POSITIVE_INFINITY });

    expect(
      screen.getByRole("heading", { name: "Detail from server" }),
    ).toBeVisible();
  });

  it("still renders when the server prefetch fails — the client takes over", async () => {
    // No handler: the prefetch's request fails (unhandled → network error),
    // yet the section must not throw and the client fetches on its own.
    backend.use(
      rpc(TasksService.method.getTaskStats, () => {
        throw new Error("boom");
      }),
    );

    await expect(DashboardStatsSection()).resolves.toBeTruthy();
  });
});

describe("fallbacks", () => {
  it("are labelled busy placeholders", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <NuqsTestingAdapter>
          <DashboardStatsFallback />
          <TaskListFallback />
          <TaskDetailsFallback />
        </NuqsTestingAdapter>
      </NextIntlClientProvider>,
    );

    expect(container.querySelectorAll('[aria-busy="true"]').length).toBe(3);
    expect(screen.getAllByRole("status").length).toBe(3);
  });
});
