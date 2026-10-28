"use client";

import { cn } from "cn";
import { useTranslations } from "next-intl";

/**
 * A busy region of skeleton placeholders with an accessible name: a
 * `role="status"` container announces "Loading" to screen readers, which a
 * bare skeleton (an empty div) never does. Pass the placeholders as children,
 * or none to render a single block sized by `className`.
 */
function LoadingSkeleton({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const t = useTranslations("common.a11y");
  return (
    <div
      data-slot="loading-skeleton"
      role="status"
      aria-busy="true"
      className={cn(
        !children && "animate-pulse rounded-md bg-muted",
        className,
      )}
      {...props}
    >
      <span className="sr-only">{t("loading")}</span>
      {children}
    </div>
  );
}

export { LoadingSkeleton };
