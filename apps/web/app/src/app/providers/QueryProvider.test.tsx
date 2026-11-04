import { useQuery } from "@connectrpc/connect-query";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QueryProvider } from "@/app/providers/QueryProvider";
import { TasksService } from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";
import { AuthProvider, useAuth } from "@/shared/lib/auth/AuthProvider";
import { routerMock } from "@/test/mocks/navigation";
import { backend, Code, rpcError } from "@/test/mocks/transport";
import { messages } from "@/test/render";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

function Probe() {
  const { isAuthenticated } = useAuth();
  const { isError } = useQuery(
    TasksService.method.getTaskStats,
    {},
    { retry: false },
  );
  return (
    <p>
      {isAuthenticated ? "signed-in" : "signed-out"}:{isError ? "error" : "ok"}
    </p>
  );
}

function renderTree() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AuthProvider initialUserId="user-1">
        <QueryProvider transport={backend.transport}>
          <Probe />
        </QueryProvider>
      </AuthProvider>
    </NextIntlClientProvider>,
  );
}

describe("QueryProvider session handling", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/en/tasks?status=done");
  });

  it("signs out, explains why, and sends the user to login with a way back when the session lapses", async () => {
    backend.use(
      rpcError(
        TasksService.method.getTaskStats,
        Code.Unauthenticated,
        "expired",
      ),
    );

    renderTree();

    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith(
        `/?next=${encodeURIComponent("/tasks?status=done")}`,
      ),
    );
    expect(toast.error).toHaveBeenCalledWith(
      messages.common.errors.sessionExpired,
      { id: "app-error:session" },
    );
    expect(await screen.findByText(/signed-out/)).toBeInTheDocument();
  });

  it("reacts once, not once per failing request", async () => {
    backend.use(
      rpcError(
        TasksService.method.getTaskStats,
        Code.Unauthenticated,
        "expired",
      ),
    );

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AuthProvider initialUserId="user-1">
          <QueryProvider transport={backend.transport}>
            <Probe />
            <Probe />
            <Probe />
          </QueryProvider>
        </AuthProvider>
      </NextIntlClientProvider>,
    );

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalled());
    expect(routerMock.replace).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("leaves the session alone for ordinary server errors", async () => {
    backend.use(
      rpcError(TasksService.method.getTaskStats, Code.Internal, "boom"),
    );

    renderTree();

    expect(await screen.findByText("signed-in:error")).toBeInTheDocument();
    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
