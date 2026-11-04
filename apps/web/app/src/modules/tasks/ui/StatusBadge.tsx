import { useTranslations } from "next-intl";

import { STATUS_BADGE_VARIANT, STATUS_KEYS } from "@/modules/tasks/lib/labels";
import type { TaskStatus } from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";
import { Badge } from "@/shared/ui/badge";

export function StatusBadge({ status }: { status: TaskStatus }) {
  const t = useTranslations("tasks.status");
  const tA11y = useTranslations("tasks.a11y");
  const key = STATUS_KEYS[status];
  if (!key) {
    return null;
  }
  return (
    <Badge variant={STATUS_BADGE_VARIANT[status]}>
      <span className="sr-only">
        {tA11y("status")}: {t(key)}
      </span>
      <span aria-hidden="true">{t(key)}</span>
    </Badge>
  );
}
