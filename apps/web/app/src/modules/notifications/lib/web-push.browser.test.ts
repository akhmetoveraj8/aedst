import { afterEach, describe, expect, it, vi } from "vitest";

import {
  base64UrlToBytes,
  describeBrowser,
  rememberDeviceId,
  rememberedDeviceId,
  resubscribeOnKeyRotation,
  subscribeToPush,
  subscriptionKeys,
  subscriptionUsesKey,
} from "@/modules/notifications/lib/web-push";

describe("base64UrlToBytes", () => {
  it("decodes base64url without padding", () => {
    expect([...base64UrlToBytes("AQID_-8")]).toEqual([1, 2, 3, 255, 239]);
  });
});

describe("subscriptionKeys", () => {
  it("extracts endpoint and keys, and rejects incomplete subscriptions", () => {
    const subscription = (json: object) =>
      ({ toJSON: () => json }) as unknown as PushSubscription;
    expect(
      subscriptionKeys(
        subscription({
          endpoint: "https://push.example/1",
          keys: { p256dh: "p", auth: "a" },
        }),
      ),
    ).toEqual({ endpoint: "https://push.example/1", p256dh: "p", auth: "a" });
    expect(() =>
      subscriptionKeys(subscription({ endpoint: "https://push.example/1" })),
    ).toThrow();
  });
});

describe("device id memory", () => {
  it("round-trips and clears", () => {
    rememberDeviceId("dev-1");
    expect(rememberedDeviceId()).toBe("dev-1");
    rememberDeviceId(null);
    expect(rememberedDeviceId()).toBeNull();
  });
});

describe("describeBrowser", () => {
  it.each([
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
      "Chrome · Windows",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "Safari · iOS",
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0",
      "Firefox · Linux",
    ],
    ["curl/8", "Browser"],
  ])("%s → %s", (ua, expected) => {
    expect(describeBrowser(ua)).toBe(expected);
  });
});

// VAPID key rotation: docs/content/server/push.md ("VAPID key rotation").
describe("VAPID key rotation", () => {
  const oldKey = "AQID"; // bytes 1,2,3
  const newKey = "BAUG"; // bytes 4,5,6

  function bytes(...values: number[]) {
    return new Uint8Array(values).buffer;
  }

  function makeSubscription(key: ArrayBuffer | null) {
    return {
      options: { applicationServerKey: key },
      unsubscribe: vi.fn().mockResolvedValue(true),
    } as unknown as PushSubscription & {
      unsubscribe: ReturnType<typeof vi.fn>;
    };
  }

  function stubBrowser(
    existing: PushSubscription | null,
    permission: NotificationPermission = "granted",
  ) {
    const created = makeSubscription(bytes(4, 5, 6));
    const pushManager = {
      getSubscription: vi.fn(async () => existing),
      subscribe: vi.fn(async () => created),
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
      },
    });
    return { pushManager, created };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "serviceWorker");
  });

  it("compares a subscription's applicationServerKey with the server key", () => {
    expect(subscriptionUsesKey(makeSubscription(bytes(1, 2, 3)), oldKey)).toBe(
      true,
    );
    expect(subscriptionUsesKey(makeSubscription(bytes(1, 2, 3)), newKey)).toBe(
      false,
    );
    expect(subscriptionUsesKey(makeSubscription(null), oldKey)).toBe(false);
  });

  it("subscribeToPush reuses a subscription made with the current key", async () => {
    const existing = makeSubscription(bytes(4, 5, 6));
    const { pushManager } = stubBrowser(existing);

    await expect(subscribeToPush(newKey)).resolves.toBe(existing);

    expect(existing.unsubscribe).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("subscribeToPush replaces a subscription made with a rotated-out key", async () => {
    const stale = makeSubscription(bytes(1, 2, 3));
    const { pushManager, created } = stubBrowser(stale);

    await expect(subscribeToPush(newKey)).resolves.toBe(created);

    expect(stale.unsubscribe).toHaveBeenCalledOnce();
    expect(pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(newKey),
    });
  });

  it("resubscribeOnKeyRotation unsubscribes and resubscribes with the new key, returning the new subscription", async () => {
    const stale = makeSubscription(bytes(1, 2, 3));
    const { pushManager, created } = stubBrowser(stale);

    await expect(resubscribeOnKeyRotation(newKey)).resolves.toBe(created);

    expect(stale.unsubscribe).toHaveBeenCalledOnce();
    expect(pushManager.subscribe).toHaveBeenCalledOnce();
  });

  it("does nothing when the key did not change", async () => {
    const current = makeSubscription(bytes(4, 5, 6));
    const { pushManager } = stubBrowser(current);

    await expect(resubscribeOnKeyRotation(newKey)).resolves.toBeNull();

    expect(current.unsubscribe).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("does nothing without a subscription, without permission, or without a server key", async () => {
    const none = stubBrowser(null);
    await expect(resubscribeOnKeyRotation(newKey)).resolves.toBeNull();
    expect(none.pushManager.subscribe).not.toHaveBeenCalled();

    const stale = makeSubscription(bytes(1, 2, 3));
    const denied = stubBrowser(stale, "denied");
    await expect(resubscribeOnKeyRotation(newKey)).resolves.toBeNull();
    expect(stale.unsubscribe).not.toHaveBeenCalled();
    expect(denied.pushManager.subscribe).not.toHaveBeenCalled();

    stubBrowser(stale);
    await expect(resubscribeOnKeyRotation("")).resolves.toBeNull();
    expect(stale.unsubscribe).not.toHaveBeenCalled();
  });

  it("runs concurrent rotations once", async () => {
    const stale = makeSubscription(bytes(1, 2, 3));
    const { pushManager } = stubBrowser(stale);

    await Promise.all([
      resubscribeOnKeyRotation(newKey),
      resubscribeOnKeyRotation(newKey),
    ]);

    expect(pushManager.subscribe).toHaveBeenCalledOnce();
  });
});
