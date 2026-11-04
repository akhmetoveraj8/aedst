import type { MessageInitShape } from "@bufbuild/protobuf";

import {
  PushPlatform,
  type RegisterPushDeviceRequestSchema,
} from "@/shared/api/connect/generated/aedst/notifications/v1/notifications_pb";

/**
 * The `RegisterPushDevice` request for a browser push subscription. Typed
 * against the generated schema (so a contract change fails the build) and
 * shared by the service worker, which re-registers a rotated subscription.
 * Returns null when the subscription is incomplete: registering it would
 * only be rejected by the server.
 */
export function buildRegisterPushDeviceRequest(
  subscription: PushSubscriptionJSON,
): MessageInitShape<typeof RegisterPushDeviceRequestSchema> | null {
  const { endpoint, keys } = subscription;
  if (!endpoint || !keys?.p256dh || !keys.auth) {
    return null;
  }
  return {
    platform: PushPlatform.WEB_PUSH,
    webPush: { endpoint, p256dh: keys.p256dh, auth: keys.auth },
  };
}
