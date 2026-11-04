"use client";

import { useMutation, useQuery } from "@connectrpc/connect-query";
import { useLocale } from "next-intl";
import { useEffect, useState } from "react";

import {
  describeBrowser,
  getPushSupport,
  rememberDeviceId,
  rememberedDeviceId,
  resubscribeOnKeyRotation,
  subscriptionKeys,
} from "@/modules/notifications/lib/web-push";
import { NotificationsService } from "@/shared/api/connect/client";
import { PushPlatform } from "@/shared/api/connect/generated/aedst/notifications/v1/notifications_pb";
import { reportError } from "@/shared/lib/errors/report-error";

/**
 * On every app start of a browser that already opted in, compare its
 * subscription's key with `GetWebPushConfig` and, if the server rotated the
 * VAPID key, resubscribe and re-register. The procedure is defined in
 * docs/content/server/push.md ("VAPID key rotation"). Mounted with the bell,
 * i.e. on every signed-in page (which includes the notification settings).
 */
export function usePushKeyRotation() {
  const locale = useLocale();
  const [optedIn, setOptedIn] = useState(false);

  useEffect(() => {
    setOptedIn(
      getPushSupport() === "supported" &&
        Notification.permission === "granted" &&
        rememberedDeviceId() !== null,
    );
  }, []);

  const config = useQuery(
    NotificationsService.method.getWebPushConfig,
    {},
    {
      enabled: optedIn,
      staleTime: Number.POSITIVE_INFINITY,
      meta: { silent: true, feature: "notifications" },
    },
  );
  const { mutateAsync: register } = useMutation(
    NotificationsService.method.registerPushDevice,
    { meta: { silent: true, feature: "notifications" } },
  );
  const vapidKey = config.data?.vapidPublicKey ?? "";

  useEffect(() => {
    if (!vapidKey) {
      return;
    }
    void (async () => {
      const subscription = await resubscribeOnKeyRotation(vapidKey);
      if (!subscription) {
        return;
      }
      const { deviceId } = await register({
        platform: PushPlatform.WEB_PUSH,
        webPush: subscriptionKeys(subscription),
        deviceName: describeBrowser(navigator.userAgent),
        locale,
      });
      rememberDeviceId(deviceId);
    })().catch((error) =>
      reportError(error, { source: "push", feature: "notifications" }),
    );
  }, [vapidKey, register, locale]);
}
