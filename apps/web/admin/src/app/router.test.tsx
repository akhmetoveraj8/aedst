import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearSession } from "@/app/auth/session";
import { createAppRouter } from "@/app/router";
import commonMessages from "@/shared/i18n/catalogs/admin-common/en.json";

function stubSession(roles: string[] | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/auth/session")) {
        return roles
          ? Response.json({ authenticated: true, email: "a@b.c", roles })
          : new Response(null, { status: 401 });
      }
      // Any RPC: a definitive "not found" keeps the screens in their error state.
      return Response.json(
        { code: "not_found", message: "none" },
        { status: 404 },
      );
    }),
  );
}

async function open(path: string) {
  const router = createAppRouter(
    createMemoryHistory({ initialEntries: [path] }),
  );
  render(<RouterProvider router={router} />);
  await router.load();
  return router;
}

beforeEach(() => clearSession());
afterEach(() => vi.unstubAllGlobals());

describe("admin router", () => {
  it("sends `/` to the overview in the negotiated locale", async () => {
    stubSession(["admin"]);
    const router = await open("/");
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/en/admin"),
    );
  });

  it("prefixes a path without a locale", async () => {
    stubSession(["admin"]);
    const router = await open("/admin/tasks?q=abc");
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/en/admin/tasks"),
    );
    expect(router.state.location.search).toEqual({ q: "abc" });
  });

  it("keeps a signed-in user without an operator role out of the panel", async () => {
    stubSession(["customer"]);
    const router = await open("/en/admin");
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/en/forbidden"),
    );
    expect(
      await screen.findByRole("heading", {
        name: commonMessages.errors.forbiddenTitle,
      }),
    ).toBeVisible();
  });

  it("gates a page by permission (support cannot read the audit log)", async () => {
    stubSession(["support"]);
    const router = await open("/en/admin/audit");
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/en/forbidden"),
    );
  });

  it("shows a translated 404 inside the locale layout", async () => {
    stubSession(["admin"]);
    await open("/en/nowhere");
    expect(
      await screen.findByRole("heading", {
        name: commonMessages.errors.notFoundTitle,
      }),
    ).toBeVisible();
  });

  it("does not let a bad search param crash a list route", async () => {
    stubSession(["admin"]);
    const router = await open("/en/admin/tasks?q=%00&cursors[]=1");
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/en/admin/tasks"),
    );
  });
});
