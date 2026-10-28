import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationBell } from "@/modules/notifications/ui/NotificationBell";
import { NotificationsService } from "@/shared/api/connect/generated/aedst/notifications/v1/notifications_pb";
import { backend, rpc } from "@/test/mocks/transport";
import { renderWithProviders } from "@/test/render";

const reportError = vi.hoisted(() => vi.fn());
vi.mock("@/shared/lib/errors/report-error", () => ({ reportError }));

const setAppBadge = vi.fn().mockResolvedValue(undefined);
const clearAppBadge = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  reportError.mockReset();
  setAppBadge.mockClear();
  clearAppBadge.mockClear();
  Object.defineProperty(navigator, "setAppBadge", {
    configurable: true,
    value: setAppBadge,
  });
  Object.defineProperty(navigator, "clearAppBadge", {
    configurable: true,
    value: clearAppBadge,
  });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "setAppBadge");
  Reflect.deleteProperty(navigator, "clearAppBadge");
});

describe("NotificationBell", () => {
  it("mirrors the unread count on the installed app icon", async () => {
    backend.use(
      rpc(NotificationsService.method.getUnreadCount, () => ({ unread: 4 })),
    );
    renderWithProviders(<NotificationBell />);
    await waitFor(() => expect(setAppBadge).toHaveBeenCalledWith(4));
  });

  it("clears the badge at zero unread", async () => {
    backend.use(
      rpc(NotificationsService.method.getUnreadCount, () => ({ unread: 0 })),
    );
    renderWithProviders(<NotificationBell />);
    await waitFor(() => expect(clearAppBadge).toHaveBeenCalled());
    expect(setAppBadge).not.toHaveBeenCalledWith(expect.any(Number));
  });

  it("reports an error the service worker relays, as source service-worker", async () => {
    backend.use(
      rpc(NotificationsService.method.getUnreadCount, () => ({ unread: 0 })),
    );
    renderWithProviders(<NotificationBell />);
    await waitFor(() => expect(clearAppBadge).toHaveBeenCalled());

    navigator.serviceWorker.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "SW_ERROR", feature: "notifications", message: "boom" },
      }),
    );
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), {
      source: "service-worker",
      feature: "notifications",
    });
  });
});
