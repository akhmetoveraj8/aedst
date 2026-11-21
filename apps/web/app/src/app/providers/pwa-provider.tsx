"use client";

import { SerwistProvider, useSerwist } from "@serwist/turbopack/react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { toast } from "sonner";

import { isProduction } from "@/shared/env/client";
import { registerBeforeSignOut } from "@/shared/lib/auth/sign-out-hooks";

/**
 * Registers the service worker in production builds only (a worker in
 * `next dev` fights hot reloading). `cacheOnNavigation` is off on purpose:
 * it would store every visited page — per-user HTML — in the cache, which
 * `sw.ts`'s policy forbids. `reloadOnOnline` is off so reconnecting never
 * throws away a half-filled form.
 */
export function PwaProvider({ children }: { children: React.ReactNode }) {
  return (
    <SerwistProvider
      swUrl="/serwist/sw.js"
      disable={!isProduction}
      cacheOnNavigation={false}
      reloadOnOnline={false}
      options={{ scope: "/", type: "classic", updateViaCache: "none" }}
    >
      <ServiceWorkerLifecycle />
      {children}
    </SerwistProvider>
  );
}

/**
 * - A new deployment's worker waits; the user decides when to switch
 *   ("Reload"), so an update never swaps the app under an open form.
 * - Signing out clears the runtime caches on this device.
 */
function ServiceWorkerLifecycle() {
  const t = useTranslations("common.pwa");
  const { serwist } = useSerwist();

  useEffect(() => {
    if (!serwist) {
      return;
    }
    const onWaiting = () => {
      toast(t("updateAvailable"), {
        id: "sw-update",
        duration: Number.POSITIVE_INFINITY,
        action: {
          label: t("reload"),
          onClick: () => {
            serwist.addEventListener("controlling", () => {
              window.location.reload();
            });
            serwist.messageSkipWaiting();
          },
        },
      });
    };
    serwist.addEventListener("waiting", onWaiting);
    return () => serwist.removeEventListener("waiting", onWaiting);
  }, [serwist, t]);

  useEffect(
    () =>
      registerBeforeSignOut(async () => {
        const registration = await navigator.serviceWorker?.getRegistration();
        registration?.active?.postMessage({ type: "CLEAR_RUNTIME_CACHES" });
      }),
    [],
  );

  return null;
}
