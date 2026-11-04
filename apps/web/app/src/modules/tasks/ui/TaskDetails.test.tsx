import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { tasksQueryKey } from "@/modules/tasks/lib/task-query-keys";
import { TaskDetails } from "@/modules/tasks/ui/TaskDetails";
import {
  TaskPriority,
  TaskStatus,
  TasksService,
} from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";
import { reportError } from "@/shared/lib/errors/report-error";
import { makeTask } from "@/test/fixtures";
import { routerMock } from "@/test/mocks/navigation";
import { backend, Code, rpc, rpcError } from "@/test/mocks/transport";
import { messages, renderWithProviders } from "@/test/render";

vi.mock("@/shared/lib/errors/report-error", () => ({
  reportError: vi.fn(),
}));

const t = messages.tasks.details;

describe("TaskDetails", () => {
  it("shows the task with its facts", async () => {
    const task = makeTask({
      title: "Ship it",
      description: "Before Friday",
      priority: TaskPriority.HIGH,
      status: TaskStatus.IN_PROGRESS,
    });
    backend.use(rpc(TasksService.method.getTask, () => ({ task })));

    renderWithProviders(<TaskDetails taskId={String(task.id)} />);

    expect(
      await screen.findByRole("heading", { name: "Ship it" }),
    ).toBeVisible();
    expect(screen.getByText("Before Friday")).toBeVisible();
    expect(screen.getByText(t.noDueDate)).toBeVisible();
    expect(screen.getByRole("link", { name: t.backToList })).toHaveAttribute(
      "href",
      "/tasks",
    );
  });

  it("says 'not found' for a missing (or someone else's) task", async () => {
    backend.use(
      rpcError(TasksService.method.getTask, Code.NotFound, "no such task"),
    );

    renderWithProviders(<TaskDetails taskId="x" />);

    expect(await screen.findByText(t.notFoundTitle)).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("distinguishes a load failure from 'not found', and offers a retry", async () => {
    backend.use(rpcError(TasksService.method.getTask, Code.Internal, "boom"));
    renderWithProviders(<TaskDetails taskId="x" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      t.loadErrorTitle,
    );
    expect(screen.queryByText(t.notFoundTitle)).not.toBeInTheDocument();

    const task = makeTask({ title: "Recovered" });
    backend.use(rpc(TasksService.method.getTask, () => ({ task })));
    await userEvent.click(
      screen.getByRole("button", { name: messages.tasks.list.retry }),
    );

    expect(
      await screen.findByRole("heading", { name: "Recovered" }),
    ).toBeVisible();
  });

  it("completes a task and reflects the refreshed status", async () => {
    const task = makeTask({ title: "Do it" });
    let status = TaskStatus.TODO;
    backend.use(
      rpc(TasksService.method.getTask, () => ({
        task: { ...task, status },
      })),
      rpc(TasksService.method.completeTask, (input) => {
        expect(input.id).toBe(task.id);
        status = TaskStatus.DONE;
        return { task: { ...task, status } };
      }),
    );
    renderWithProviders(<TaskDetails taskId={String(task.id)} />);

    await userEvent.click(
      await screen.findByRole("button", { name: t.complete }),
    );

    expect(await screen.findByRole("button", { name: t.reopen })).toBeVisible();
  });

  it("shows a mutation failure inline (and not also as a toast)", async () => {
    const task = makeTask();
    backend.use(
      rpc(TasksService.method.getTask, () => ({ task })),
      rpcError(TasksService.method.completeTask, Code.Internal, "disk full"),
    );
    const onUserFacingError = vi.fn();
    renderWithProviders(<TaskDetails taskId={String(task.id)} />, {
      callbacks: { onUserFacingError },
    });

    await userEvent.click(
      await screen.findByRole("button", { name: t.complete }),
    );

    const alert = await screen.findByRole("alert");
    // The translated kind, never the server's diagnostic text.
    expect(alert).toHaveTextContent(messages.common.errors.kinds.unknown);
    expect(alert).not.toHaveTextContent("disk full");
    expect(onUserFacingError).not.toHaveBeenCalled();
    // The raw error goes to Sentry, tagged with the procedure (mutationKey).
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ rawMessage: "disk full" }),
      expect.objectContaining({
        source: "mutation",
        procedure: "aedst.tasks.v1.TasksService/CompleteTask",
        feature: "tasks",
      }),
    );
  });

  it("invalidates only TasksService queries after a write, not the whole cache", async () => {
    const task = makeTask();
    backend.use(
      rpc(TasksService.method.getTask, () => ({ task })),
      rpc(TasksService.method.completeTask, () => ({ task })),
    );
    const { queryClient } = renderWithProviders(
      <TaskDetails taskId={String(task.id)} />,
    );
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    await userEvent.click(
      await screen.findByRole("button", { name: t.complete }),
    );

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy).not.toHaveBeenCalledWith();
    expect(spy).toHaveBeenCalledWith({ queryKey: tasksQueryKey() });
    expect(tasksQueryKey()).toEqual([
      "connect-query",
      { serviceName: "aedst.tasks.v1.TasksService" },
    ]);
  });

  it("asks for confirmation before deleting, then returns to the list", async () => {
    const task = makeTask();
    let deleted: string | undefined;
    backend.use(
      rpc(TasksService.method.getTask, () => ({ task })),
      rpc(TasksService.method.deleteTask, (input) => {
        deleted = input.id;
        return {};
      }),
    );
    renderWithProviders(<TaskDetails taskId={String(task.id)} />);

    await userEvent.click(
      await screen.findByRole("button", { name: t.delete }),
    );
    // The dialog is a lazy chunk: allow its first import to finish.
    expect(
      await screen.findByText(t.deleteConfirmTitle, {}, { timeout: 10_000 }),
    ).toBeVisible();
    expect(deleted).toBeUndefined();

    await userEvent.click(
      screen.getByRole("button", { name: t.deleteConfirmAction }),
    );

    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/tasks"));
    expect(deleted).toBe(task.id);
  });

  it("switches to the edit form", async () => {
    const task = makeTask({ title: "Edit me" });
    backend.use(rpc(TasksService.method.getTask, () => ({ task })));
    renderWithProviders(<TaskDetails taskId={String(task.id)} />);

    await userEvent.click(await screen.findByRole("button", { name: t.edit }));

    expect(
      await screen.findByLabelText(
        messages.tasks.form.titleLabel,
        {},
        { timeout: 10_000 },
      ),
    ).toHaveValue("Edit me");
  });
});
