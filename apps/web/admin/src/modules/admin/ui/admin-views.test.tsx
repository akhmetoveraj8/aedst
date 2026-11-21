import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AdminNav } from "@/modules/admin/ui/admin-nav";
import { AdminOverview } from "@/modules/admin/ui/admin-overview";
import { AuditLog } from "@/modules/admin/ui/audit-log";
import { BroadcastForm } from "@/modules/admin/ui/broadcast-form";
import { AdminService } from "@/shared/api/connect/generated/aedst/admin/v1/admin_pb";
import { backend, Code, rpc, rpcError } from "@/test/mocks/transport";
import { messages, renderWithProviders } from "@/test/render";

const t = messages.admin;
const USER_ID = "00000000-0000-4000-8000-000000000201";

describe("AdminOverview", () => {
  it("shows the counts, formatting storage as bytes", async () => {
    backend.use(
      rpc(AdminService.method.getOverview, () => ({
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
    renderWithProviders(
      <AdminNav allowed={["overview", "tasks", "broadcast", "audit"]} />,
    );
    for (const name of [t.nav.overview, t.nav.tasks, t.nav.audit]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
  });

  it("shows only the sections the role may open", () => {
    renderWithProviders(<AdminNav allowed={["overview", "audit"]} />);
    expect(screen.getByRole("link", { name: t.nav.audit })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: t.nav.tasks }),
    ).not.toBeInTheDocument();
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
