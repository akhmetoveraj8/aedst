"use client";

import { Code, ConnectError } from "@connectrpc/connect";
import { useMutation, useQuery } from "@connectrpc/connect-query";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import {
  describeBrowser,
  getActiveSubscription,
  getPushSupport,
  PushPermissionError,
  type PushSupport,
  rememberDeviceId,
  rememberedDeviceId,
  subscribeToPush,
  subscriptionKeys,
} from "@/modules/notifications/lib/web-push";
import { NotificationsService } from "@/shared/api/connect/client";
import { PushPlatform } from "@/shared/api/connect/generated/aedst/notifications/v1/notifications_pb";
import { track } from "@/shared/lib/analytics/analytics";
import { reportError } from "@/shared/lib/errors/report-error";
import { Button } from "@/shared/ui/button";

type Status =
  | "checking"
  | PushSupport
  | "not-configured"
  | "blocked"
  | "off"
  | "on";

/**
 * Web Push opt-in for this browser: GetWebPushConfig (VAPID key) →
 * Notification permission → PushManager.subscribe → RegisterPushDevice
 * (WEB_PUSH). Only ever started by a click — browsers penalise permission
 * prompts that are not a response to a user gesture.
 */
export function PushOptIn() {
  const t = useTranslations("notifications.push");
  const locale = useLocale();
  const [status, setStatus] = useState<Status>("checking");
  const [failed, setFailed] = useState(false);

  const config = useQuery(
    NotificationsService.method.getWebPushConfig,
    {},
    { staleTime: Number.POSITIVE_INFINITY, meta: { feature: "notifications" } },
  );
  const register = useMutation(NotificationsService.method.registerPushDevice, {
    meta: { silent: true, feature: "notifications" },
  });
  const unregister = useMutation(
    NotificationsService.method.unregisterPushDevice,
    { meta: { silent: true, feature: "notifications" } },
  );
  const vapidKey = config.data?.vapidPublicKey ?? "";

  useEffect(() => {
    const support = getPushSupport();
    if (support !== "supported") {
      setStatus(support);
      return;
    }
    if (config.isSuccess && !vapidKey) {
      setStatus("not-configured");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("blocked");
      return;
    }
    void getActiveSubscription().then((subscription) =>
      setStatus(subscription && rememberedDeviceId() ? "on" : "off"),
    );
  }, [config.isSuccess, vapidKey]);

  async function enable() {
    setFailed(false);
    try {
      const subscription = await subscribeToPush(vapidKey);
      const { deviceId } = await register.mutateAsync({
        platform: PushPlatform.WEB_PUSH,
        webPush: subscriptionKeys(subscription),
        deviceName: describeBrowser(navigator.userAgent),
        locale,
      });
      rememberDeviceId(deviceId);
      setStatus("on");
      track("push_opt_in", { result: "granted" });
    } catch (error) {
      if (error instanceof PushPermissionError) {
        setStatus(error.permission === "denied" ? "blocked" : "off");
        track("push_opt_in", { result: "denied" });
        return;
      }
      setFailed(true);
      track("push_opt_in", { result: "error" });
      reportError(error, { source: "push", feature: "notifications" });
    }
  }

  async function disable() {
    setFailed(false);
    const deviceId = rememberedDeviceId();
    try {
      if (deviceId) {
        await unregister.mutateAsync({ deviceId });
      }
    } catch (error) {
      // Already gone server-side is fine; anything else is worth knowing.
      if (!(error instanceof ConnectError && error.code === Code.NotFound)) {
        setFailed(true);
        return;
      }
    }
    rememberDeviceId(null);
    await (await getActiveSubscription())?.unsubscribe();
    setStatus("off");
  }

  const busy = register.isPending || unregister.isPending;

  return (
    <section
      aria-labelledby="push-heading"
      className="flex flex-col gap-3 rounded-lg border p-4"
    >
      <h2 id="push-heading" className="font-medium">
        {t("title")}
      </h2>
      <p className="text-muted-foreground text-sm" role="status">
        {status === "checking" && t("checking")}
        {status === "unsupported" && t("unsupported")}
        {status === "requires-install" && t("requiresInstall")}
        {status === "not-configured" && t("notConfigured")}
        {status === "blocked" && t("blocked")}
        {status === "off" && t("off")}
        {status === "on" && t("on")}
      </p>
      {status === "off" && (
        <Button className="w-fit" disabled={busy} onClick={enable}>
          {t("enable")}
        </Button>
      )}
      {status === "on" && (
        <Button
          variant="outline"
          className="w-fit"
          disabled={busy}
          onClick={disable}
        >
          {t("disable")}
        </Button>
      )}
      {failed && (
        <p role="alert" className="text-destructive text-sm">
          {t("failed")}
        </p>
      )}
    </section>
  );
}
