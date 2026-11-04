"use client";

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "cn";
import { useTranslations } from "next-intl";
import type * as React from "react";

type SpinnerProps = Omit<React.ComponentProps<"svg">, "strokeWidth">;

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
      className={cn("size-4 animate-spin", className)}
    />
  );
}

export { Spinner };
