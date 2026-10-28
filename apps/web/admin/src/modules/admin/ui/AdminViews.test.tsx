import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AdminNav } from "@/modules/admin/ui/AdminNav";
import { AdminOverview } from "@/modules/admin/ui/AdminOverview";
import { AdminUsers } from "@/modules/admin/ui/AdminUsers";
import { AuditLog } from "@/modules/admin/ui/AuditLog";
import { BroadcastForm } from "@/modules/admin/ui/BroadcastForm";
import { AdminService } from "@/shared/api/connect/generated/aedst/admin/v1/admin_pb";
import { backend, Code, rpc, rpcError } from "@/test/mocks/transport";
import { messages, renderWithProviders } from "@/test/render";

const t = messages.admin;
const USER_ID = "00000000-0000-4000-8000-000000000201";

describe("AdminOverview", () => {
  it("shows the counts, formatting storage as bytes", async () => {
    backend.use(
      rpc(AdminService.method.getOverview, () => ({
        usersTotal: 12n,
        tasksTotal: 340n,
        mediaBytes: 5_000_000n,
      })),
    );
    renderWithProviders(<AdminOverview />);
    expect(await screen.findByText("340")).toBeInTheDocument();
    expect(screen.getByText(t.overview.metrics.mediaBytes)).toBeInTheDocument();
    expect(screen.getByText(/5\s?MB/)).toBeInTheDocument();
  });

  it("offers a retry when the overview fails", async () => {
    backend.use(rpcError(AdminService.method.getOverview, Code.Internal, "x"));
    renderWithProviders(<AdminOverview />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      t.overview.loadError,
    );
  });
});

describe("AdminUsers", () => {
  it("lists users and pages forward and back with keyset tokens", async () => {
    const tokens: string[] = [];
    backend.use(
      rpc(AdminService.method.listUsers, (input) => {
        tokens.push(input.pageToken);
        return input.pageToken
          ? { users: [{ id: "2", email: "b@example.com", taskCount: 1n }] }
          : {
              users: [
                {
                  id: "1",
                  email: "a@example.com",
                  taskCount: 3n,
                  createdAt: timestampFromDate(new Date("2026-01-01")),
                },
              ],
              nextPageToken: "page-2",
            };
      }),
    );
    renderWithProviders(<AdminUsers />);

    expect(await screen.findByText("a@example.com")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: t.table.next }));
    expect(await screen.findByText("b@example.com")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: t.table.previous }),
    );
    expect(await screen.findByText("a@example.com")).toBeInTheDocument();
    expect(tokens).toEqual(["", "page-2", ""]);
  });

  it("restores the search and page from the URL (reload, shared link)", async () => {
    const inputs: { query: string; pageToken: string }[] = [];
    backend.use(
      rpc(AdminService.method.listUsers, (input) => {
        inputs.push({ query: input.query, pageToken: input.pageToken });
        return { users: [] };
      }),
    );
    renderWithProviders(<AdminUsers />, { searchParams: "?q=ada&cursors=p2" });
    expect(screen.getByLabelText(t.users.search)).toHaveValue("ada");
    await waitFor(() =>
      expect(inputs).toContainEqual({ query: "ada", pageToken: "p2" }),
    );
  });

  it("searches by email", async () => {
    const queries: string[] = [];
    backend.use(
      rpc(AdminService.method.listUsers, (input) => {
        queries.push(input.query);
        return { users: [] };
      }),
    );
    renderWithProviders(<AdminUsers />);
    await userEvent.type(screen.getByLabelText(t.users.search), "ada");
    await waitFor(() => expect(queries).toContain("ada"));
    expect(await screen.findByText(t.users.empty)).toBeInTheDocument();
  });
});

describe("AuditLog", () => {
  it("renders entries", async () => {
    backend.use(
      rpc(AdminService.method.listAuditLog, () => ({
        entries: [
          {
            id: "e1",
            actorId: USER_ID,
            action: "task.delete",
            targetKind: "task",
            targetId: USER_ID,
            reason: "spam",
            createdAt: timestampFromDate(new Date("2026-02-01T10:00:00Z")),
          },
        ],
      })),
    );
    renderWithProviders(<AuditLog />);
    expect(await screen.findByText("task.delete")).toBeInTheDocument();
    expect(screen.getByText("spam")).toBeInTheDocument();
  });
});

describe("BroadcastForm", () => {
  it("validates like the proto, then sends to everyone", async () => {
    const sent: { userId: string; title: string; link: string }[] = [];
    backend.use(
      rpc(AdminService.method.broadcastNotification, (input) => {
        sent.push({
          userId: input.userId,
          title: input.title,
          link: input.link,
        });
        return { recipients: 3n };
      }),
    );
    renderWithProviders(<BroadcastForm />);
    const b = t.broadcast;

    await userEvent.type(screen.getByLabelText(b.userId), "not-a-uuid");
    await userEvent.type(screen.getByLabelText(b.link), "https://evil.example");
    await userEvent.click(screen.getByRole("button", { name: b.send }));
    expect(await screen.findByText(b.userIdInvalid)).toBeInTheDocument();
    expect(screen.getByText(b.titleRequired)).toBeInTheDocument();
    expect(screen.getByText(b.linkInvalid)).toBeInTheDocument();
    expect(sent).toEqual([]);

    // A 121-character title is "too long", not "required".
    await userEvent.click(screen.getByLabelText(b.titleLabel));
    await userEvent.paste("a".repeat(121));
    await userEvent.click(screen.getByRole("button", { name: b.send }));
    expect(await screen.findByText(b.titleTooLong)).toBeInTheDocument();
    expect(screen.queryByText(b.titleRequired)).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText(b.titleLabel));

    await userEvent.clear(screen.getByLabelText(b.userId));
    await userEvent.clear(screen.getByLabelText(b.link));
    await userEvent.type(screen.getByLabelText(b.titleLabel), "Maintenance");
    await userEvent.type(screen.getByLabelText(b.link), "/tasks");
    await userEvent.click(screen.getByRole("button", { name: b.send }));

    await waitFor(() =>
      expect(sent).toEqual([
        { userId: "", title: "Maintenance", link: "/tasks" },
      ]),
    );
  });
});

describe("AdminNav", () => {
  it("links every admin section", () => {
    renderWithProviders(<AdminNav />);
    for (const name of [
      t.nav.overview,
      t.nav.users,
      t.nav.tasks,
      t.nav.audit,
    ]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
  });
});

describe("sparse rows", () => {
  it("renders placeholders for missing dates and targets", async () => {
    backend.use(
      rpc(AdminService.method.listAuditLog, () => ({
        entries: [
          { id: "e2", action: "notification.broadcast", targetKind: "user" },
        ],
      })),
    );
    renderWithProviders(<AuditLog />);
    expect(
      await screen.findByText("notification.broadcast"),
    ).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("user")).toBeInTheDocument();
  });

  it("shows the load error in the table", async () => {
    backend.use(rpcError(AdminService.method.listAuditLog, Code.Internal, "x"));
    renderWithProviders(<AuditLog />);
    expect(await screen.findByText(t.audit.loadError)).toBeInTheDocument();
  });
});
