"use client";

import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useLocale, useTranslations } from "next-intl";
import { type KeyboardEvent, useRef } from "react";
import type { Notification } from "@/shared/api/connect/generated/aedst/notifications/v1/notifications_pb";
import { formatRelative } from "@/shared/date/format-date";
import { useSentinel } from "@/shared/lib/hooks/use-sentinel";
import { Button } from "@/shared/ui/button";

const ESTIMATED_ROW_PX = 88;
const ROW_GAP_PX = 8;

type Props = {
  items: readonly Notification[];
  onOpen: (item: Notification) => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
};

/**
 * The reference virtual list (docs/content/web/architecture.md, "Virtual
 * lists"): TanStack Virtual renders only the rows near the viewport of a
 * scroll container, rows are measured (their height varies with the text),
 * and an IntersectionObserver sentinel after the list fetches the next page.
 *
 * Accessibility: it stays a real list (`ul`/`li`); because rows are unmounted
 * `aria-posinset`/`aria-setsize` tell assistive tech where a row sits (size
 * `-1` while more pages exist), every row is a native button, and Arrow
 * Up/Down, Home and End move focus between rows, scrolling to ones not yet
 * mounted.
 */
export function NotificationsList({
  items,
  onOpen,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: Props) {
  const t = useTranslations("notifications.inbox");
  const locale = useLocale();
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_PX,
    gap: ROW_GAP_PX,
    overscan: 6,
  });

  const sentinelRef = useSentinel(() => fetchNextPage(), {
    enabled: hasNextPage && !isFetchingNextPage,
  });

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const current = Number(
      (event.target as HTMLElement).closest("li")?.dataset.index,
    );
    const last = items.length - 1;
    let next: number;
    if (event.key === "ArrowDown") {
      next = Math.min(current + 1, last);
    } else if (event.key === "ArrowUp") {
      next = Math.max(current - 1, 0);
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = last;
    } else {
      return;
    }
    if (Number.isNaN(current)) {
      return;
    }
    event.preventDefault();
    virtualizer.scrollToIndex(next);
    requestAnimationFrame(() =>
      scrollRef.current
        ?.querySelector<HTMLElement>(`[data-index="${next}"] button`)
        ?.focus(),
    );
  }

  return (
    <div ref={scrollRef} style={{ maxHeight: "70vh", overflowY: "auto" }}>
      <ul
        aria-label={t("listLabel")}
        onKeyDown={onKeyDown}
        style={{
          position: "relative",
          width: "100%",
          height: virtualizer.getTotalSize(),
        }}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const item = items[row.index];
          if (!item) {
            return null;
          }
          return (
            <li
              key={item.id}
              data-index={row.index}
              ref={virtualizer.measureElement}
              aria-posinset={row.index + 1}
              aria-setsize={hasNextPage ? -1 : items.length}
              style={{
                position: "absolute",
                top: 0,
                insetInlineStart: 0,
                width: "100%",
                transform: `translateY(${row.start}px)`,
              }}
            >
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpen(item)}
                className="h-auto w-full flex-col items-stretch justify-start gap-1 whitespace-normal rounded-lg border p-3 text-start font-normal hover:bg-muted data-[unread=true]:border-primary/40 data-[unread=true]:bg-primary/5"
                data-unread={!item.readAt}
              >
                <span className="flex items-center gap-2">
                  {!item.readAt && (
                    <span className="size-2 shrink-0 rounded-full bg-primary">
                      <span className="sr-only">{t("unreadMarker")}</span>
                    </span>
                  )}
                  <span className="font-medium">{item.title}</span>
                </span>
                {item.body && (
                  <span className="text-foreground/70 text-sm">
                    {item.body}
                  </span>
                )}
                {item.createdAt && (
                  <time
                    className="text-foreground/70 text-xs"
                    dateTime={timestampDate(item.createdAt).toISOString()}
                  >
                    {formatRelative(timestampDate(item.createdAt), locale)}
                  </time>
                )}
              </Button>
            </li>
          );
        })}
      </ul>
      <div ref={sentinelRef} aria-hidden="true" className="h-px" />
    </div>
  );
}
