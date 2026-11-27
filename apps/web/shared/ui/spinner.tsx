"use client";

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "cn";
import type * as React from "react";
import { useTranslations } from "use-intl";

type SpinnerProps = Omit<React.ComponentProps<"svg">, "strokeWidth">;

/**
 * An inline wait indicator with an accessible name (`role="status"`), for
 * buttons and short operations. For a placeholder of content that is still
 * loading use `LoadingSkeleton` (announced) or `Skeleton` (decorative).
 */
function Spinner({ className, ...props }: SpinnerProps) {
  const t = useTranslations("common.a11y");
  return (
    <HugeiconsIcon
      icon={Loading03Icon}
      {...props}
      strokeWidth={2}
      data-slot="spinner"
      role="status"
      aria-label={t("loading")}
      className={cn(
        "size-4 animate-spin motion-reduce:animate-none",
        className,
      )}
    />
  );
}

export { Spinner };
