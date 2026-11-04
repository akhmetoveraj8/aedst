import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationBell } from "@/modules/notifications/ui/NotificationBell";
import { NotificationPreferences } from "@/modules/notifications/ui/NotificationPreferences";
import {
  NotificationsService,
  PushPlatform,
} from "@/shared/api/connect/generated/aedst/notifications/v1/notifications_pb";
import { runBeforeSignOut } from "@/shared/lib/auth/sign-out-hooks";
import { backend, Code, rpc, rpcError } from "@/test/mocks/transport";
import { messages, renderWithProviders } from "@/test/render";

const t = messages.notifications;
const DEVICE_ID = "00000000-0000-4000-8000-000000000401";

function servePreferences() {
  let saved: Record<string, boolean> | undefined;
  backend.use(
    rpc(NotificationsService.method.getPreferences, () => ({
      preferences: {
        pushEnabled: true,
        taskCompleted: true,
        taskDueSoon: true,
        mediaReady: false,
      },
    })),
    rpc(NotificationsService.method.updatePreferences, (input) => {
      saved = { ...input.preferences } as unknown as Record<string, boolean>;
      return { preferences: input.preferences };
    }),
  );
  return () => saved;
}

/** A browser with the Push API: permission granted, subscription returned. */
function stubPushApis(permission: NotificationPermission = "granted") {
  const unsubscribe = vi.fn().mockResolvedValue(true);
  let current: PushSubscription | null = null;
  const subscription = {
    toJSON: () => ({
      endpoint: "https://push.example/sub",
      keys: { p256dh: "p256", auth: "auth" },
    }),
    unsubscribe,
  } as unknown as PushSubscription;
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async () => {
      current = subscription;
      return subscription;
    }),
  };
  const registration = { pushManager };
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal(
    "Notification",
    Object.assign(class {}, {
      permission,
      requestPermission: vi.fn().mockResolvedValue(permission),
    }),
  );
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: Promise.resolve(registration),
      getRegistration: vi.fn().mockResolvedValue(registration),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
  return { pushManager, unsubscribe };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("NotificationPreferences", () => {
  it("saves a toggle optimistically and confirms", async () => {
    const saved = servePreferences();
    backend.use(
      rpc(NotificationsService.method.getWebPushConfig, () => ({
        vapidPublicKey: "",
      })),
    );
    renderWithProviders(<NotificationPreferences />);

    const toggle = await screen.findByRole("switch", {
      name: t.preferences.toggles.taskDueSoon,
    });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);

    await waitFor(() => expect(saved()?.taskDueSoon).toBe(false));
    expect(saved()?.taskCompleted).toBe(true);
  });

  it("explains when this browser has no Push API", async () => {
    vi.stubGlobal("PushManager", undefined);
    vi.stubGlobal("Notification", undefined);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: undefined,
    });
    servePreferences();
    backend.use(
      rpc(NotificationsService.method.getWebPushConfig, () => ({
        vapidPublicKey: "BOk",
      })),
    );
    renderWithProviders(<NotificationPreferences />);
    expect(await screen.findByText(t.push.unsupported)).toBeInTheDocument();
  });

  it("subscribes with the server's VAPID key and registers a WEB_PUSH device; turns it off again", async () => {
    servePreferences();
    const { pushManager, unsubscribe } = stubPushApis();
    const registered: { platform: PushPlatform; endpoint?: string }[] = [];
    const unregistered: string[] = [];
    backend.use(
      rpc(NotificationsService.method.getWebPushConfig, () => ({
        vapidPublicKey: "AQID",
      })),
      rpc(NotificationsService.method.registerPushDevice, (input) => {
        registered.push({
          platform: input.platform,
          endpoint: input.webPush?.endpoint,
        });
        return { deviceId: DEVICE_ID };
      }),
      rpc(NotificationsService.method.unregisterPushDevice, (input) => {
        unregistered.push(input.deviceId);
        return {};
      }),
    );
    renderWithProviders(<NotificationPreferences />);

    await userEvent.click(
      await screen.findByRole("button", { name: t.push.enable }),
    );
    expect(await screen.findByText(t.push.on)).toBeInTheDocument();
    expect(registered).toEqual([
      { platform: PushPlatform.WEB_PUSH, endpoint: "https://push.example/sub" },
    ]);
    expect([
      ...(
        pushManager.subscribe.mock.calls[0] as unknown as [
          { applicationServerKey: Uint8Array },
        ]
      )[0].applicationServerKey,
    ]).toEqual([1, 2, 3]);

    await userEvent.click(screen.getByRole("button", { name: t.push.disable }));
    expect(await screen.findByText(t.push.off)).toBeInTheDocument();
    expect(unregistered).toEqual([DEVICE_ID]);
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("reports blocked notifications", async () => {
    servePreferences();
    stubPushApis("denied");
    backend.use(
      rpc(NotificationsService.method.getWebPushConfig, () => ({
        vapidPublicKey: "AQID",
      })),
    );
    renderWithProviders(<NotificationPreferences />);
    expect(await screen.findByText(t.push.blocked)).toBeInTheDocument();
  });

  it("offers a retry when preferences fail to load", async () => {
    backend.use(
      rpcError(NotificationsService.method.getPreferences, Code.Internal, "x"),
      rpc(NotificationsService.method.getWebPushConfig, () => ({})),
    );
    renderWithProviders(<NotificationPreferences />);
    expect(
      await screen.findByText(t.preferences.loadError),
    ).toBeInTheDocument();
  });
});

describe("NotificationBell", () => {
  it("shows the unread count and unregisters this browser's push device on sign-out", async () => {
    stubPushApis();
    localStorage.setItem("aedst-push-device-id", DEVICE_ID);
    const unregistered: string[] = [];
    backend.use(
      rpc(NotificationsService.method.getUnreadCount, () => ({
        unread: 120,
      })),
      // Opted-in browser: the key-rotation check reads the current VAPID key.
      rpc(NotificationsService.method.getWebPushConfig, () => ({
        vapidPublicKey: "AQID",
      })),
      rpc(NotificationsService.method.unregisterPushDevice, (input) => {
        unregistered.push(input.deviceId);
        return {};
      }),
    );
    renderWithProviders(<NotificationBell />);

    const bell = await screen.findByRole("link", { name: /120 unread/ });
    expect(bell).toHaveTextContent("99+");

    await runBeforeSignOut();
    expect(unregistered).toEqual([DEVICE_ID]);
    expect(localStorage.getItem("aedst-push-device-id")).toBeNull();
  });
});
