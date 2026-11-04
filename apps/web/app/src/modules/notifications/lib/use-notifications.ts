"use client";

import { createConnectQueryKey, useMutation } from "@connectrpc/connect-query";
import { useQueryClient } from "@tanstack/react-query";

import { NotificationsService } from "@/shared/api/connect/client";
import { track } from "@/shared/lib/analytics/analytics";

/** Every NotificationsService query (inbox pages, unread count). */
const notificationsKey = createConnectQueryKey({
  schema: NotificationsService,
  cardinality: undefined,
});

/** Mark some/all read, then refresh the inbox and the bell's count. */
export function useMarkNotifications() {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: notificationsKey });

  const markRead = useMutation(NotificationsService.method.markRead, {
    meta: { feature: "notifications" },
    onSuccess: (_data, variables) => {
      track("notifications_marked_read", { count: variables.ids?.length ?? 0 });
      return invalidate();
    },
  });
  const markAllRead = useMutation(NotificationsService.method.markAllRead, {
    meta: { feature: "notifications" },
    onSuccess: (data) => {
      track("notifications_marked_read", { count: data.marked });
      return invalidate();
    },
  });

  return { markRead, markAllRead, invalidate };
}
