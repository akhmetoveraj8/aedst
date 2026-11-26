"use client";

import { ArrowUpRight01Icon, Globe02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { cn } from "cn";
import type * as React from "react";

import {
  AiChainOfThought,
  AiChainOfThoughtContent,
  AiChainOfThoughtHeader,
  type AiChainOfThoughtHeaderProps,
  type AiChainOfThoughtProps,
} from "@/shared/ui/ai-chain-of-thought";
import { citationHostname } from "@/shared/ui/ai-inline-citation";

/** The links the agent used for a reply: a line that opens into a list. */
function AiSources({ className, ...props }: AiChainOfThoughtProps) {
  return (
    <AiChainOfThought data-slot="ai-sources" className={className} {...props} />
  );
}

/**
 * The line with the count, worded by the caller ("Used 3 sources"), so the
 * user knows what opens before opening it.
 */
function AiSourcesTrigger({
  icon = Globe02Icon,
  ...props
}: AiChainOfThoughtHeaderProps) {
  return (
    <AiChainOfThoughtHeader
      data-slot="ai-sources-trigger"
      icon={icon}
      {...props}
    />
  );
}

/** Holds the `AiSource` links as a list. */
function AiSourcesContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AiChainOfThoughtContent>) {
  return (
    <AiChainOfThoughtContent
      data-slot="ai-sources-content"
      className={className}
      {...props}
    >
      <ul className="flex flex-col">{children}</ul>
    </AiChainOfThoughtContent>
  );
}

interface AiSourceProps
  extends Omit<React.ComponentProps<"a">, "title" | "target" | "rel"> {
  href: string;
  /** Link text; falls back to the host name of `href`. */
  title?: React.ReactNode;
  /** Read after the title, e.g. "(opens in a new tab)". */
  newTabLabel?: string;
  icon?: IconSvgElement;
}

/** One source: a link that opens in a new tab; the arrow is decorative. */
function AiSource({
  href,
  title,
  newTabLabel,
  icon,
  className,
  ...props
}: AiSourceProps) {
  return (
    <li data-slot="ai-source">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={cn(
          "group/ai-source flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring motion-reduce:transition-none",
          className,
        )}
        {...props}
      >
        {icon ? (
          <HugeiconsIcon
            icon={icon}
            strokeWidth={2}
            aria-hidden="true"
            className="size-4 shrink-0"
          />
        ) : null}
        <span className="min-w-0 truncate text-start">
          {title ?? <span dir="ltr">{citationHostname(href)}</span>}
          {newTabLabel ? <span className="sr-only"> {newTabLabel}</span> : null}
        </span>
        <HugeiconsIcon
          icon={ArrowUpRight01Icon}
          strokeWidth={2}
          aria-hidden="true"
          className="size-4 shrink-0 rtl:-scale-x-100"
        />
      </a>
    </li>
  );
}

export {
  AiSource,
  type AiSourceProps,
  AiSources,
  AiSourcesContent,
  AiSourcesTrigger,
};
