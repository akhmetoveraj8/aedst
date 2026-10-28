"use client";

import { useMutation } from "@connectrpc/connect-query";
import { useEffect } from "react";

import {
  getActiveSubscription,
  rememberDeviceId,
  rememberedDeviceId,
} from "@/modules/notifications/lib/web-push";
import { NotificationsService } from "@/shared/api/connect/client";
import { registerBeforeSignOut } from "@/shared/lib/auth/sign-out-hooks";
import { reportError } from "@/shared/lib/errors/report-error";
import { clearAppBadge } from "@/shared/lib/pwa/app-badge";

/**
 * Signing out unregisters this browser's push device (while the session can
 * still authenticate the call) and drops the subscription, so the next
 * person to sign in on this device never receives the previous user's
 * notifications. Mounted with the bell, i.e. on every signed-in page.
 */
export function usePushSignOutCleanup() {
  const { mutateAsync: unregister } = useMutation(
    NotificationsService.method.unregisterPushDevice,
    { meta: { silent: true, feature: "notifications" } },
  );

  useEffect(
    () =>
      registerBeforeSignOut(async () => {
        await clearAppBadge();
        const deviceId = rememberedDeviceId();
        rememberDeviceId(null);
        if (deviceId) {
          await unregister({ deviceId }).catch((error) =>
            reportError(error, { source: "push", feature: "notifications" }),
          );
        }
        await (await getActiveSubscription())?.unsubscribe();
      }),
    [unregister],
  );
}
