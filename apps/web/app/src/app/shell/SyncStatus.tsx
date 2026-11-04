"use client";

import { useTranslations } from "next-intl";

import { useOutboxItems } from "@/shared/lib/outbox/OutboxProvider";
import { Badge } from "@/shared/ui/badge";

/**
 * How many offline writes still wait for the server, and how many were
 * rejected for good. Renders nothing when the queue is empty; announced
 * politely so a screen reader hears it settle.
 */
export function SyncStatus() {
  const t = useTranslations("common.sync");
  const items = useOutboxItems();
  const pending = items.filter((item) => item.status === "pending").length;
  const failed = items.length - pending;

  return (
    <div role="status" aria-live="polite" className="flex flex-wrap gap-2">
      {pending > 0 && (
        <Badge variant="secondary">{t("pending", { count: pending })}</Badge>
      )}
      {failed > 0 && (
        <Badge variant="destructive">{t("failed", { count: failed })}</Badge>
      )}
    </div>
  );
}
