import { useTranslations } from "next-intl";

import {
  PRIORITY_BADGE_VARIANT,
  PRIORITY_KEYS,
} from "@/modules/tasks/lib/labels";
import type { TaskPriority } from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";
import { Badge } from "@/shared/ui/badge";

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const t = useTranslations("tasks.priority");
  const tA11y = useTranslations("tasks.a11y");
  const key = PRIORITY_KEYS[priority];
  if (!key) {
    return null;
  }
  return (
    <Badge variant={PRIORITY_BADGE_VARIANT[priority]}>
      {/* Colour alone must not carry meaning, and a bare "Urgent" reads
          ambiguously in a screen reader — say what the value is *of*. */}
      <span className="sr-only">
        {tA11y("priority")}: {t(key)}
      </span>
      <span aria-hidden="true">{t(key)}</span>
    </Badge>
  );
}
