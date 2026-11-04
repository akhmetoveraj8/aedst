import { create, toJson } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { RegisterPushDeviceRequestSchema } from "@/shared/api/connect/generated/aedst/notifications/v1/notifications_pb";
import { buildRegisterPushDeviceRequest } from "@/shared/lib/pwa/push-device";

describe("buildRegisterPushDeviceRequest", () => {
  it("matches the RegisterPushDevice contract on the wire", () => {
    const init = buildRegisterPushDeviceRequest({
      endpoint: "https://push.example/abc",
      keys: { p256dh: "key-p", auth: "key-a" },
    });
    expect(init).not.toBeNull();
    if (!init) {
      return;
    }
    expect(
      toJson(
        RegisterPushDeviceRequestSchema,
        create(RegisterPushDeviceRequestSchema, init),
      ),
    ).toEqual({
      platform: "PUSH_PLATFORM_WEB_PUSH",
      webPush: {
        endpoint: "https://push.example/abc",
        p256dh: "key-p",
        auth: "key-a",
      },
    });
  });

  it.each([
    {},
    { endpoint: "https://push.example/abc" },
    { endpoint: "https://push.example/abc", keys: { p256dh: "k" } },
    { keys: { p256dh: "k", auth: "a" } },
  ])("returns null for an incomplete subscription %j", (subscription) => {
    expect(
      buildRegisterPushDeviceRequest(subscription as PushSubscriptionJSON),
    ).toBeNull();
  });
});
