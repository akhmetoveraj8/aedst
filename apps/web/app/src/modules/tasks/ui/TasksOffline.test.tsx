import { ConnectError } from "@connectrpc/connect";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTaskOutboxHandlers } from "@/modules/tasks/lib/outbox-handlers";
import { CreateTaskPage } from "@/modules/tasks/ui/CreateTaskPage";
import { PendingTasks } from "@/modules/tasks/ui/PendingTasks";
import { TaskDetails } from "@/modules/tasks/ui/TaskDetails";
import { TasksService } from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";
import { createIdbOutboxStore } from "@/shared/lib/outbox/idb-store";
import { createOutbox } from "@/shared/lib/outbox/outbox";
import { makeTask } from "@/test/fixtures";
import { routerMock } from "@/test/mocks/navigation";
import { backend, Code, rpc, rpcError } from "@/test/mocks/transport";
import { messages, renderWithProviders } from "@/test/render";

const tForm = messages.tasks.form;
const tSync = messages.tasks.sync;
const dbs: string[] = [];

afterEach(async () => {
  for (const name of dbs.splice(0)) {
    indexedDB.deleteDatabase(name);
  }
});

function testOutbox() {
  const name = `tasks-offline-${crypto.randomUUID()}`;
  dbs.push(name);
  return createOutbox({
    store: createIdbOutboxStore(name),
    owner: "user-1",
    handlers: async () =>
      new Map(
        createTaskOutboxHandlers(backend.transport).map((h) => [h.type, h]),
      ),
  });
}

function goOffline() {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
}

describe("tasks offline writes", () => {
  it("queues a create made offline, lists it as pending, and delivers it with the item id as Idempotency-Key", async () => {
    goOffline();
    const outbox = testOutbox();
    renderWithProviders(
      <>
        <CreateTaskPage />
        <PendingTasks />
      </>,
      { outbox },
    );

    await userEvent.type(screen.getByLabelText(tForm.titleLabel), "Buy milk");
    await userEvent.click(screen.getByRole("button", { name: tForm.create }));

    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/tasks"));
    expect(backend.inputsOf(TasksService.method.createTask)).toEqual([]);
    expect(await screen.findByText("Buy milk")).toBeVisible();
    expect(screen.getByText(tSync.pendingBadge)).toBeVisible();

    const [queued] = await outbox.list();
    expect(queued).toMatchObject({ type: "task.create", status: "pending" });
    let key: string | null = null;
    backend.use(
      rpc(TasksService.method.createTask, (_input, context) => {
        key = context.requestHeader.get("idempotency-key");
        return { task: makeTask({ title: "Buy milk" }) };
      }),
    );
    await act(() => outbox.run());

    expect(key).toBe(queued?.id);
    await waitFor(() =>
      expect(screen.queryByText("Buy milk")).not.toBeInTheDocument(),
    );
  });

  it("queues with the same key when the first attempt fails retryably, so a lost response is not applied twice", async () => {
    const outbox = testOutbox();
    const keys: Array<string | null> = [];
    backend.use(
      rpc(TasksService.method.createTask, (_input, context) => {
        keys.push(context.requestHeader.get("idempotency-key"));
        throw new ConnectError("down", Code.Unavailable);
      }),
    );
    renderWithProviders(<CreateTaskPage />, { outbox });

    await userEvent.type(screen.getByLabelText(tForm.titleLabel), "Retry me");
    await userEvent.click(screen.getByRole("button", { name: tForm.create }));

    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/tasks"));
    const queued = await outbox.list();
    expect(queued).toHaveLength(1);
    expect(keys).toEqual([queued[0]?.id]);
  });

  it("does not queue a definitive rejection; the form shows it", async () => {
    const outbox = testOutbox();
    backend.use(
      rpcError(
        TasksService.method.createTask,
        Code.InvalidArgument,
        "title too long",
      ),
    );
    renderWithProviders(<CreateTaskPage />, { outbox });

    await userEvent.type(screen.getByLabelText(tForm.titleLabel), "x");
    await userEvent.click(screen.getByRole("button", { name: tForm.create }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(messages.common.errors.kinds.invalidInput);
    expect(alert).not.toHaveTextContent("title too long");
    expect(await outbox.list()).toEqual([]);
  });

  it("shows an offline edit at once with a pending-sync badge", async () => {
    const task = makeTask({ title: "Old title" });
    backend.use(rpc(TasksService.method.getTask, () => ({ task })));
    const outbox = testOutbox();
    renderWithProviders(<TaskDetails taskId={String(task.id)} />, { outbox });
    await userEvent.click(
      await screen.findByRole("button", { name: messages.tasks.details.edit }),
    );
    goOffline();

    const title = await screen.findByLabelText(tForm.titleLabel);
    await userEvent.clear(title);
    await userEvent.type(title, "New title");
    await userEvent.click(screen.getByRole("button", { name: tForm.save }));

    expect(
      await screen.findByRole("heading", { name: "New title" }),
    ).toBeVisible();
    expect(await screen.findByText(tSync.pendingBadge)).toBeVisible();
    expect(await outbox.list()).toMatchObject([
      { type: "task.update", status: "pending" },
    ]);
  });
});
