import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { TaskList } from "@/modules/tasks/ui/TaskList";
import {
  SortDirection,
  TaskPriority,
  TaskSortField,
  TaskStatus,
  TasksService,
} from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";
import { makeTask } from "@/test/fixtures";
import { backend, Code, rpc, rpcError } from "@/test/mocks/transport";
import { messages, renderWithProviders } from "@/test/render";

const t = messages.tasks.list;

type Captured = {
  statuses: TaskStatus[];
  priorities: TaskPriority[];
  search: string;
  sortBy: TaskSortField;
  sortDirection: SortDirection;
  pageToken: string;
};

function serveTasks(
  respond: (input: Captured) => {
    tasks: ReturnType<typeof makeTask>[];
    nextPageToken?: string;
  },
) {
  const requests: Captured[] = [];
  backend.use(
    rpc(TasksService.method.listTasks, (input) => {
      requests.push(input as unknown as Captured);
      return respond(input as unknown as Captured);
    }),
  );
  return requests;
}

describe("TaskList", () => {
  it("lists tasks, with badges that say what they are for screen readers", async () => {
    serveTasks(() => ({
      tasks: [
        makeTask({
          title: "Write report",
          priority: TaskPriority.URGENT,
          status: TaskStatus.IN_PROGRESS,
        }),
        makeTask({ title: "Buy milk" }),
      ],
    }));

    renderWithProviders(<TaskList />);

    const list = await screen.findByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(
      within(items[0] as HTMLElement).getByRole("link"),
    ).toHaveAccessibleName(
      /Write report.*Priority: Urgents*Status: In progress/s,
    );
  });

  it("links each task to its detail page", async () => {
    const task = makeTask({ title: "Linked" });
    serveTasks(() => ({ tasks: [task] }));

    renderWithProviders(<TaskList />);

    expect(await screen.findByRole("link", { name: /Linked/ })).toHaveAttribute(
      "href",
      `/tasks/${task.id}`,
    );
  });

  describe("empty and error states", () => {
    it("invites the first task when nothing exists and nothing is filtered", async () => {
      serveTasks(() => ({ tasks: [] }));

      renderWithProviders(<TaskList />);

      expect(await screen.findByText(t.emptyTitle)).toBeVisible();
      expect(
        screen.getAllByRole("link", { name: t.newTask }).length,
      ).toBeGreaterThan(0);
    });

    it("explains an empty *filtered* result differently", async () => {
      serveTasks(() => ({ tasks: [] }));

      renderWithProviders(<TaskList />, { searchParams: "?status=done" });

      expect(await screen.findByText(t.noResultsTitle)).toBeVisible();
      expect(screen.queryByText(t.emptyTitle)).not.toBeInTheDocument();
    });

    it("announces a failed load and retries on demand", async () => {
      backend.use(
        rpcError(TasksService.method.listTasks, Code.Internal, "boom"),
      );
      renderWithProviders(<TaskList />);

      expect(await screen.findByRole("alert")).toHaveTextContent(t.errorTitle);

      const requests = serveTasks(() => ({
        tasks: [makeTask({ title: "Recovered" })],
      }));
      await userEvent.click(screen.getByRole("button", { name: t.retry }));

      expect(await screen.findByText("Recovered")).toBeVisible();
      expect(requests).toHaveLength(1);
    });
  });

  describe("URL state", () => {
    it("restores filters, search and sort from the URL — a shared link shows the same view", async () => {
      const requests = serveTasks(() => ({ tasks: [makeTask()] }));

      renderWithProviders(<TaskList />, {
        searchParams: "?q=report&status=done&priority=high&sort=due-asc",
      });

      await screen.findByRole("list");
      expect(requests[0]).toMatchObject({
        search: "report",
        statuses: [TaskStatus.DONE],
        priorities: [TaskPriority.HIGH],
        sortBy: TaskSortField.DUE_DATE,
        sortDirection: SortDirection.ASC,
      });
      expect(
        screen.getByRole("searchbox", { name: t.searchLabel }),
      ).toHaveValue("report");
    });

    it("labels every filter control for assistive tech", async () => {
      serveTasks(() => ({ tasks: [] }));

      renderWithProviders(<TaskList />);

      expect(screen.getByRole("search")).toBeInTheDocument();
      for (const name of [
        t.statusFilterLabel,
        t.priorityFilterLabel,
        t.sortLabel,
      ]) {
        expect(
          await screen.findByRole("combobox", { name }, { timeout: 5000 }),
        ).toBeInTheDocument();
      }
    });
  });

  describe("search", () => {
    it("waits for a pause in typing: one request for the final text, not one per key", async () => {
      const requests = serveTasks(() => ({ tasks: [] }));
      const updates: string[] = [];
      renderWithProviders(<TaskList />, {
        onUrlUpdate: (event) => updates.push(event.queryString),
      });
      await screen.findByText(t.emptyTitle);
      const initial = requests.length;

      await userEvent.type(
        screen.getByRole("searchbox", { name: t.searchLabel }),
        "milk",
      );

      // The box is instant; nothing has been sent or written to the URL yet.
      expect(requests.length).toBe(initial);
      expect(updates).toEqual([]);

      await waitFor(
        () => expect(requests.some((r) => r.search === "milk")).toBe(true),
        {
          timeout: 2000,
        },
      );

      expect(updates.at(-1)).toContain("q=milk");
      expect(
        requests.filter((r) => r.search !== "" && r.search !== "milk"),
      ).toEqual([]);
    });
  });

  describe("pagination", () => {
    it("pages forward through cursors kept in the URL, and back again", async () => {
      const requests = serveTasks((input) =>
        input.pageToken === ""
          ? {
              tasks: [makeTask({ title: "First page" })],
              nextPageToken: "page-2",
            }
          : { tasks: [makeTask({ title: "Second page" })] },
      );
      const updates: string[] = [];
      renderWithProviders(<TaskList />, {
        onUrlUpdate: (event) => updates.push(event.queryString),
      });

      await screen.findByText("First page");
      expect(
        screen.getByRole("button", { name: t.previousPage }),
      ).toBeDisabled();

      await userEvent.click(screen.getByRole("button", { name: t.nextPage }));
      expect(await screen.findByText("Second page")).toBeVisible();
      expect(updates.at(-1)).toContain("cursors=page-2");
      expect(requests.at(-1)?.pageToken).toBe("page-2");
      expect(screen.getByRole("button", { name: t.nextPage })).toBeDisabled();

      await userEvent.click(
        screen.getByRole("button", { name: t.previousPage }),
      );
      expect(await screen.findByText("First page")).toBeVisible();
      expect(updates.at(-1) ?? "").not.toContain("cursors");
    });

    it("survives a reload: the page is restored from the URL cursor", async () => {
      const requests = serveTasks((input) => ({
        tasks: [
          makeTask({
            title: input.pageToken === "page-3" ? "Page three" : "Other",
          }),
        ],
      }));

      renderWithProviders(<TaskList />, {
        searchParams: "?cursors=page-2,page-3",
      });

      expect(await screen.findByText("Page three")).toBeVisible();
      expect(requests[0]?.pageToken).toBe("page-3");
      // ...and "previous" still works after that reload.
      expect(
        screen.getByRole("button", { name: t.previousPage }),
      ).toBeEnabled();
    });

    it("hides pagination when there is a single short page", async () => {
      serveTasks(() => ({ tasks: [] }));

      renderWithProviders(<TaskList />);
      await screen.findByText(t.emptyTitle);

      expect(
        screen.queryByRole("navigation", { name: t.paginationLabel }),
      ).not.toBeInTheDocument();
    });
  });
});
