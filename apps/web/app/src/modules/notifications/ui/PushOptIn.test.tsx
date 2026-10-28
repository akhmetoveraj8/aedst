import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getActiveSubscription,
  getPushSupport,
  PushPermissionError,
  rememberDeviceId,
  rememberedDeviceId,
  subscribeToPush,
} from "@/modules/notifications/lib/web-push";
import { PushOptIn } from "@/modules/notifications/ui/PushOptIn";
import {
  NotificationsService,
  PushPlatform,
} from "@/shared/api/connect/generated/aedst/notifications/v1/notifications_pb";
import { track } from "@/shared/lib/analytics/analytics";
import { backend, rpc } from "@/test/mocks/transport";
import { renderWithProviders } from "@/test/render";

// Browser push APIs (permission prompt, service worker, PushManager) are the
// platform's; what is under test is the opt-in state machine around them.
vi.mock("@/modules/notifications/lib/web-push", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/modules/notifications/lib/web-push")
  >()),
  getPushSupport: vi.fn(),
  getActiveSubscription: vi.fn(),
  subscribeToPush: vi.fn(),
}));
vi.mock("@/shared/lib/analytics/analytics", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/shared/lib/analytics/analytics")
  >()),
  track: vi.fn(),
}));
vi.mock("@/shared/lib/errors/report-error", () => ({ reportError: vi.fn() }));

const SUBSCRIPTION = {
  toJSON: () => ({
    endpoint: "https://push.example/1",
    keys: { p256dh: "p", auth: "a" },
  }),
  unsubscribe: vi.fn(async () => true),
} as unknown as PushSubscription;

function configured(key = "vapid-key") {
  backend.use(
    rpc(NotificationsService.method.getWebPushConfig, () => ({
      vapidPublicKey: key,
    })),
  );
}

beforeEach(() => {
  vi.mocked(getPushSupport).mockReturnValue("supported");
  vi.mocked(getActiveSubscription).mockResolvedValue(null);
  vi.spyOn(Notification, "permission", "get").mockReturnValue("default");
});

describe("PushOptIn", () => {
  it("explains when the browser has no push support", async () => {
    vi.mocked(getPushSupport).mockReturnValue("unsupported");
    configured();
    renderWithProviders(<PushOptIn />);

    expect(
      await screen.findByText(
        "This browser doesn’t support push notifications.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Turn on" }),
    ).not.toBeInTheDocument();
  });

  it("asks iOS Safari users to install the app first", async () => {
    vi.mocked(getPushSupport).mockReturnValue("requires-install");
    configured();
    renderWithProviders(<PushOptIn />);

    expect(
      await screen.findByText(/install the app to your Home Screen/),
    ).toBeInTheDocument();
  });

  it("says push is not set up when the server has no VAPID key", async () => {
    configured("");
    renderWithProviders(<PushOptIn />);

    expect(
      await screen.findByText(
        "Push notifications aren’t set up on this server.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Turn on" }),
    ).not.toBeInTheDocument();
  });

  it("points to the browser settings when permission is blocked", async () => {
    vi.spyOn(Notification, "permission", "get").mockReturnValue("denied");
    configured();
    renderWithProviders(<PushOptIn />);

    expect(
      await screen.findByText(/Notifications are blocked for this site/),
    ).toBeInTheDocument();
  });

  it("subscribes and registers the device on a click, then offers to turn off", async () => {
    const user = userEvent.setup();
    configured("the-key");
    vi.mocked(subscribeToPush).mockResolvedValue(SUBSCRIPTION);
    const registered: unknown[] = [];
    backend.use(
      rpc(NotificationsService.method.registerPushDevice, (input) => {
        registered.push(input);
        return { deviceId: "device-9" };
      }),
    );
    renderWithProviders(<PushOptIn />);

    await user.click(await screen.findByRole("button", { name: "Turn on" }));

    expect(
      await screen.findByText("Push notifications are on for this device."),
    ).toBeInTheDocument();
    expect(subscribeToPush).toHaveBeenCalledWith("the-key");
    expect(registered).toHaveLength(1);
    expect(registered[0]).toMatchObject({
      platform: PushPlatform.WEB_PUSH,
      webPush: { endpoint: "https://push.example/1", p256dh: "p", auth: "a" },
      locale: "en",
    });
    expect(rememberedDeviceId()).toBe("device-9");
    expect(track).toHaveBeenCalledWith("push_opt_in", { result: "granted" });
    expect(
      screen.getByRole("button", { name: "Turn off" }),
    ).toBeInTheDocument();
  });

  it("stays off and reports a denied prompt without an error", async () => {
    const user = userEvent.setup();
    configured();
    vi.mocked(subscribeToPush).mockRejectedValue(
      new PushPermissionError("denied"),
    );
    renderWithProviders(<PushOptIn />);

    await user.click(await screen.findByRole("button", { name: "Turn on" }));

    expect(
      await screen.findByText(/Notifications are blocked for this site/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(track).toHaveBeenCalledWith("push_opt_in", { result: "denied" });
  });

  it("shows an error when subscribing fails for another reason", async () => {
    const user = userEvent.setup();
    configured();
    vi.mocked(subscribeToPush).mockRejectedValue(
      new Error("push service down"),
    );
    renderWithProviders(<PushOptIn />);

    await user.click(await screen.findByRole("button", { name: "Turn on" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn’t change push notifications. Try again.",
    );
    expect(track).toHaveBeenCalledWith("push_opt_in", { result: "error" });
  });

  it("turns push off: unregisters the device, forgets it and unsubscribes", async () => {
    const user = userEvent.setup();
    configured();
    rememberDeviceId("device-3");
    vi.mocked(getActiveSubscription).mockResolvedValue(SUBSCRIPTION);
    const unregistered: unknown[] = [];
    backend.use(
      rpc(NotificationsService.method.unregisterPushDevice, (input) => {
        unregistered.push(input);
        return {};
      }),
    );
    renderWithProviders(<PushOptIn />);

    await user.click(await screen.findByRole("button", { name: "Turn off" }));

    await waitFor(() =>
      expect(
        screen.getByText(/Get notified on this device/),
      ).toBeInTheDocument(),
    );
    expect(unregistered).toEqual([
      expect.objectContaining({ deviceId: "device-3" }),
    ]);
    expect(rememberedDeviceId()).toBeNull();
    expect(SUBSCRIPTION.unsubscribe).toHaveBeenCalled();
  });
});
