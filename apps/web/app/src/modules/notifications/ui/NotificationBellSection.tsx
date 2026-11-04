import { HydrationBoundary } from "@tanstack/react-query";

import { NotificationBell } from "@/modules/notifications/ui/NotificationBell";
import { NotificationsService } from "@/shared/api/connect/client";
import { createRpcPrefetcher } from "@/shared/api/connect/prefetch";

/**
 * Server Component: the unread count is prefetched with the page, so the
 * bell renders its badge in the first HTML and the browser makes no extra
 * request on load (same pattern as the tasks sections).
 */
export async function NotificationBellSection() {
  const prefetcher = createRpcPrefetcher();
  await prefetcher.prefetch(NotificationsService.method.getUnreadCount, {});
  return (
    <HydrationBoundary state={prefetcher.dehydrate()}>
      <NotificationBell />
    </HydrationBoundary>
  );
}
