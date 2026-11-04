import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AdminTasks } from "@/modules/admin/ui/AdminTasks";
import { AdminService } from "@/shared/api/connect/generated/aedst/admin/v1/admin_pb";
import { backend, rpc } from "@/test/mocks/transport";
import { messages, renderWithProviders } from "@/test/render";

const t = messages.admin.tasks;
const TASK_ID = "00000000-0000-4000-8000-000000000101";

describe("AdminTasks", () => {
  it("lists every user's tasks and deletes one only with a reason", async () => {
    const deleted: { id: string; reason: string }[] = [];
    backend.use(
      rpc(AdminService.method.listTasks, (input) => ({
        tasks: deleted.length
          ? []
          : [
              {
                id: TASK_ID,
                ownerId: "00000000-0000-4000-8000-000000000999",
                title: "Spam task",
                status: 1,
              },
            ],
        nextPageToken: input.pageToken ? "" : "next",
      })),
      rpc(AdminService.method.deleteTask, (input) => {
        deleted.push({ id: input.id, reason: input.reason });
        return {};
      }),
    );

    renderWithProviders(<AdminTasks />);

    const row = await screen.findByRole("row", { name: /Spam task/ });
    expect(within(row).getByText("Todo")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: messages.admin.table.next }),
    ).toBeEnabled();

    await userEvent.click(within(row).getByRole("button", { name: t.delete }));
    const dialog = await screen.findByRole("dialog");

    await userEvent.click(
      within(dialog).getByRole("button", { name: t.confirmDelete }),
    );
    expect(
      await within(dialog).findByText(t.reasonInvalid),
    ).toBeInTheDocument();
    expect(deleted).toEqual([]);

    await userEvent.type(within(dialog).getByLabelText(t.reason), "  spam  ");
    await userEvent.click(
      within(dialog).getByRole("button", { name: t.confirmDelete }),
    );

    await waitFor(() =>
      expect(deleted).toEqual([{ id: TASK_ID, reason: "spam" }]),
    );
  });
});
