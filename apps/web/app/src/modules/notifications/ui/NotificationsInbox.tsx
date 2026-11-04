"use client";

import { useInfiniteQuery } from "@connectrpc/connect-query";
import { useTranslations } from "next-intl";
import { parseAsBoolean, useQueryState } from "nuqs";
import { useMarkNotifications } from "@/modules/notifications/lib/use-notifications";
import { NotificationsList } from "@/modules/notifications/ui/NotificationsList";
import { NotificationsService } from "@/shared/api/connect/client";
import {
  type Notification,
  NotificationKind,
} from "@/shared/api/connect/generated/aedst/notifications/v1/notifications_pb";
import { Link, useRouter } from "@/shared/i18n/navigation";
import { track } from "@/shared/lib/analytics/analytics";
import { safeInAppPath } from "@/shared/lib/auth/safe-redirect";
import { Button, buttonVariants } from "@/shared/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/ui/empty";
import { Skeleton } from "@/shared/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";

const PAGE_SIZE = 20;

/**
 * The in-app inbox: unread/all filter in the URL, keyset paging, opening a
 * notification marks it read and follows its link, "mark all as read".
 */
export function NotificationsInbox() {
  const t = useTranslations("notifications.inbox");
  const router = useRouter();
  const [unreadOnly, setUnreadOnly] = useQueryState(
    "unread",
    parseAsBoolean.withDefault(false),
  );
  const { markRead, markAllRead } = useMarkNotifications();

  const inbox = useInfiniteQuery(
    NotificationsService.method.listNotifications,
    { unreadOnly, pageSize: PAGE_SIZE, pageToken: "" },
    {
      pageParamKey: "pageToken",
      getNextPageParam: (last) => last.nextPageToken || undefined,
      meta: { feature: "notifications" },
    },
  );
  const items = inbox.data?.pages.flatMap((page) => page.notifications) ?? [];
  const hasUnread = items.some((item) => !item.readAt);

  function open(item: Notification) {
    track("notification_opened", {
      kind: NotificationKind[item.kind] ?? "UNKNOWN",
      via: "inbox",
    });
    if (!item.readAt) {
      markRead.mutate({ ids: [item.id] });
    }
    const link = safeInAppPath(item.link);
    if (link) {
      router.push(link);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-semibold text-2xl">{t("title")}</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/notifications/preferences"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            {t("preferences")}
          </Link>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasUnread || markAllRead.isPending}
            onClick={() => markAllRead.mutate({})}
          >
            {t("markAllRead")}
          </Button>
        </div>
      </div>

      <Tabs
        value={unreadOnly ? "unread" : "all"}
        onValueChange={(value) =>
          void setUnreadOnly(value === "unread" || null)
        }
      >
        <TabsList aria-label={t("filterLabel")}>
          <TabsTrigger value="all">{t("all")}</TabsTrigger>
          <TabsTrigger value="unread">{t("unread")}</TabsTrigger>
        </TabsList>
      </Tabs>

      {inbox.isPending ? (
        <div className="flex flex-col gap-2" role="status" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : inbox.isError ? (
        <Empty role="alert">
          <EmptyHeader>
            <EmptyTitle>{t("errorTitle")}</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => inbox.refetch()}>
              {t("retry")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("emptyDescription")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <NotificationsList
          items={items}
          onOpen={open}
          hasNextPage={inbox.hasNextPage}
          isFetchingNextPage={inbox.isFetchingNextPage}
          fetchNextPage={() => void inbox.fetchNextPage()}
        />
      )}

      {inbox.hasNextPage && (
        <Button
          variant="outline"
          disabled={inbox.isFetchingNextPage}
          onClick={() => inbox.fetchNextPage()}
        >
          {t("loadMore")}
        </Button>
      )}
    </div>
  );
}
