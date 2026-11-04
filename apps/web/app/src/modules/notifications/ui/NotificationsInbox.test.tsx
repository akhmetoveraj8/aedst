import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { NotificationsInbox } from "@/modules/notifications/ui/NotificationsInbox";
import {
  NotificationKind,
  NotificationsService,
} from "@/shared/api/connect/generated/aedst/notifications/v1/notifications_pb";
import { routerMock } from "@/test/mocks/navigation";
import { backend, rpc } from "@/test/mocks/transport";
import { messages, renderWithProviders } from "@/test/render";

const t = messages.notifications.inbox;
const ID = "00000000-0000-4000-8000-000000000001";

describe("NotificationsInbox", () => {
  it("lists notifications, marks one read when opened and follows its in-app link", async () => {
    const marked: string[][] = [];
    let unreadOnly: boolean | undefined;
    backend.use(
      rpc(NotificationsService.method.listNotifications, (input) => {
        unreadOnly = input.unreadOnly;
        return {
          notifications: [
            {
              id: ID,
              kind: NotificationKind.TASK_COMPLETED,
              title: "Task completed",
              body: "Write docs",
              link: "/tasks/1",
              createdAt: timestampFromDate(new Date()),
            },
          ],
        };
      }),
      rpc(NotificationsService.method.markRead, (input) => {
        marked.push(input.ids);
        return {};
      }),
    );

    renderWithProviders(<NotificationsInbox />, {
      searchParams: "?unread=true",
    });

    await userEvent.click(
      await screen.findByRole(
        "button",
        { name: /Task completed/ },
        { timeout: 5_000 },
      ),
    );
    await waitFor(() => expect(marked).toEqual([[ID]]));
    expect(routerMock.push).toHaveBeenCalledWith("/tasks/1");
    expect(unreadOnly).toBe(true);
    // The unread dot is announced to screen readers (besides the tab label).
    expect(screen.getAllByText(t.unreadMarker)).toHaveLength(2);
  });

  it("marks everything read", async () => {
    let markedAll = false;
    backend.use(
      rpc(NotificationsService.method.listNotifications, () => ({
        notifications: [
          { id: ID, title: "Hello", link: "https://evil.example" },
        ],
      })),
      rpc(NotificationsService.method.markAllRead, () => {
        markedAll = true;
        return { marked: 1 };
      }),
      rpc(NotificationsService.method.markRead, () => ({})),
    );
    renderWithProviders(<NotificationsInbox />);

    await userEvent.click(
      await screen.findByRole("button", { name: t.markAllRead }),
    );
    await waitFor(() => expect(markedAll).toBe(true));

    // Off-site links are never followed.
    await userEvent.click(screen.getByRole("button", { name: /Hello/ }));
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it("shows the empty state", async () => {
    backend.use(
      rpc(NotificationsService.method.listNotifications, () => ({
        notifications: [],
      })),
    );
    renderWithProviders(<NotificationsInbox />);
    expect(await screen.findByText(t.emptyTitle)).toBeInTheDocument();
  });

  describe("virtual list", () => {
    const manyItems = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `00000000-0000-4000-8000-${String(from + i).padStart(12, "0")}`,
        title: `Notification ${from + i}`,
        body: "Body",
      }));

    it("renders only the rows near the viewport, with list semantics", async () => {
      backend.use(
        rpc(NotificationsService.method.listNotifications, () => ({
          notifications: manyItems(1, 300),
          nextPageToken: "more",
        })),
      );
      renderWithProviders(<NotificationsInbox />);

      const list = await screen.findByRole("list", { name: t.listLabel });
      const rows = await within(list).findAllByRole("listitem");
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.length).toBeLessThan(60);
      expect(rows[0]).toHaveAttribute("aria-posinset", "1");
      // More pages exist, so the total is unknown.
      expect(rows[0]).toHaveAttribute("aria-setsize", "-1");
    });

    it("moves focus between rows with the arrow keys", async () => {
      backend.use(
        rpc(NotificationsService.method.listNotifications, () => ({
          notifications: manyItems(1, 50),
        })),
      );
      renderWithProviders(<NotificationsInbox />);

      const first = await screen.findByRole("button", {
        name: /Notification 1(?![0-9])/,
      });
      first.focus();
      await userEvent.keyboard("{ArrowDown}");
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: /Notification 2(?![0-9])/ }),
        ).toHaveFocus(),
      );
      await userEvent.keyboard("{End}");
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: /Notification 50(?![0-9])/ }),
        ).toHaveFocus(),
      );
    });

    it("fetches the next page when the sentinel scrolls into view", async () => {
      const tokens: string[] = [];
      backend.use(
        rpc(NotificationsService.method.listNotifications, (input) => {
          tokens.push(input.pageToken);
          return input.pageToken
            ? { notifications: manyItems(101, 5) }
            : { notifications: manyItems(1, 100), nextPageToken: "p2" };
        }),
      );
      renderWithProviders(<NotificationsInbox />);

      const list = await screen.findByRole("list", { name: t.listLabel });
      const scroller = list.parentElement as HTMLElement;
      await waitFor(() => expect(scroller.scrollHeight).toBeGreaterThan(0));
      scroller.scrollTop = scroller.scrollHeight;

      await waitFor(() => expect(tokens).toEqual(["", "p2"]), {
        timeout: 5_000,
      });
    });
  });
});
