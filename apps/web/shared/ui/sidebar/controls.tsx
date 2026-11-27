"use client";

import { SidebarLeftIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "cn";
import type * as React from "react";
import { useTranslations } from "use-intl";
import { Button } from "@/shared/ui/button";
import { useSidebar } from "./context";

export function SidebarTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { toggleSidebar } = useSidebar();
  const t = useTranslations("common.a11y");

  return (
    <Button
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon-sm"
      className={cn(className)}
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      {...props}
    >
      <HugeiconsIcon
        icon={SidebarLeftIcon}
        strokeWidth={2}
        className="rtl:rotate-180"
      />
      <span className="sr-only">{t("toggleSidebar")}</span>
    </Button>
  );
}

export function SidebarRail({
  className,
  ...props
}: React.ComponentProps<"button">) {
  const { toggleSidebar } = useSidebar();
  const t = useTranslations("common.a11y");

  return (
    <button
      data-sidebar="rail"
      data-slot="sidebar-rail"
      aria-label={t("toggleSidebar")}
      tabIndex={-1}
      onClick={toggleSidebar}
      title={t("toggleSidebar")}
      className={cn(
        "absolute inset-y-0 z-20 hidden w-4 transition-all ease-linear group-data-[side=start]:-end-4 group-data-[side=end]:start-0 after:absolute after:inset-y-0 after:start-1/2 after:w-[2px] hover:after:bg-sidebar-border sm:flex -translate-x-1/2 rtl:translate-x-1/2 motion-reduce:transition-none",
        "in-data-[side=start]:cursor-w-resize rtl:in-data-[side=start]:cursor-e-resize in-data-[side=end]:cursor-e-resize rtl:in-data-[side=end]:cursor-w-resize",
        "[[data-side=start][data-state=collapsed]_&]:cursor-e-resize rtl:[[data-side=start][data-state=collapsed]_&]:cursor-w-resize [[data-side=end][data-state=collapsed]_&]:cursor-w-resize rtl:[[data-side=end][data-state=collapsed]_&]:cursor-e-resize",
        "group-data-[collapsible=offcanvas]:translate-x-0 rtl:group-data-[collapsible=offcanvas]:-translate-x-0 group-data-[collapsible=offcanvas]:after:start-full hover:group-data-[collapsible=offcanvas]:bg-sidebar",
        "[[data-side=start][data-collapsible=offcanvas]_&]:-end-2",
        "[[data-side=end][data-collapsible=offcanvas]_&]:-start-2",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarInset({
  className,
  ...props
}: React.ComponentProps<"main">) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn(
        "relative flex w-full flex-1 flex-col bg-background md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ms-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ms-2",
        className,
      )}
      {...props}
    />
  );
}
