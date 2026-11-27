"use client";

import { ArrowUpRight01Icon, Globe02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { cn } from "cn";
import type * as React from "react";
import { EXTERNAL_LINK_REL, safeHref } from "@/shared/lib/url/safe-href";
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
  const safe = safeHref(href);
  const content = (
    <>
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
        {safe && newTabLabel ? (
          <span className="sr-only"> {newTabLabel}</span>
        ) : null}
      </span>
      {safe ? (
        <HugeiconsIcon
          icon={ArrowUpRight01Icon}
          strokeWidth={2}
          aria-hidden="true"
          className="size-4 shrink-0 rtl:-scale-x-100"
        />
      ) : null}
    </>
  );
  const rowClass =
    "group/ai-source flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground outline-none transition-colors motion-reduce:transition-none";
  return (
    <li data-slot="ai-source">
      {safe ? (
        <a
          href={safe}
          target="_blank"
          rel={EXTERNAL_LINK_REL}
          className={cn(
            rowClass,
            "hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring pointer-coarse:min-h-11",
            className,
          )}
          {...props}
        >
          {content}
        </a>
      ) : (
        <span className={cn(rowClass, className)}>{content}</span>
      )}
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
