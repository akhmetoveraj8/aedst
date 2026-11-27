"use client";

import { cn } from "cn";
import type * as React from "react";

import { EXTERNAL_LINK_REL, safeHref } from "@/shared/lib/url/safe-href";
import { Button } from "@/shared/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/shared/ui/hover-card";

/** Host name without `www.`, or the input when it is not a URL. */
function citationHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** A cited sentence: the text and its citation card, kept together. */
function AiInlineCitation({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="ai-inline-citation"
      className={cn("inline", className)}
      {...props}
    />
  );
}

function AiInlineCitationText({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="ai-inline-citation-text"
      className={cn(
        "transition-colors motion-reduce:transition-none",
        className,
      )}
      {...props}
    />
  );
}

/** The card that opens on hover and on keyboard focus of the trigger. */
function AiInlineCitationCard(props: React.ComponentProps<typeof HoverCard>) {
  return <HoverCard data-slot="ai-inline-citation-card" {...props} />;
}

interface AiInlineCitationCardTriggerProps
  extends Omit<React.ComponentProps<typeof HoverCardTrigger>, "children"> {
  /** URLs of the cited sources; the first host name is the visible label. */
  sources: readonly string[];
  /** Hidden from sight, read after the label, e.g. "and 2 more sources". */
  moreLabel?: string;
}

/**
 * A focusable button (not a badge) so keyboard users can open the card.
 * Shows the first source's host name and `+N` for the others.
 */
function AiInlineCitationCardTrigger({
  sources,
  moreLabel,
  delay = 10,
  closeDelay = 100,
  ...props
}: AiInlineCitationCardTriggerProps) {
  const [first] = sources;
  const more = sources.length - 1;
  return (
    <HoverCardTrigger
      data-slot="ai-inline-citation-card-trigger"
      delay={delay}
      closeDelay={closeDelay}
      render={
        <Button variant="secondary" size="xs" className="align-baseline" />
      }
      {...props}
    >
      <span dir="ltr">{first ? citationHostname(first) : null}</span>
      {more > 0 ? (
        <>
          <span aria-hidden="true" className="tabular-nums">
            +{more}
          </span>
          {moreLabel ? <span className="sr-only"> {moreLabel}</span> : null}
        </>
      ) : null}
    </HoverCardTrigger>
  );
}

function AiInlineCitationCardBody({
  className,
  ...props
}: React.ComponentProps<typeof HoverCardContent>) {
  return (
    <HoverCardContent
      data-slot="ai-inline-citation-card-body"
      className={cn("flex w-72 flex-col gap-3", className)}
      {...props}
    />
  );
}

interface AiInlineCitationSourceProps
  extends Omit<React.ComponentProps<"div">, "title"> {
  url: string;
  /** Falls back to the host name. */
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Read after the link text, e.g. "(opens in a new tab)". */
  newTabLabel?: string;
}

/** One source: title, description and a link that opens in a new tab. */
function AiInlineCitationSource({
  url,
  title,
  description,
  newTabLabel,
  className,
  children,
  ...props
}: AiInlineCitationSourceProps) {
  const host = citationHostname(url);
  const safe = safeHref(url);
  const linkClass =
    "self-start text-xs text-muted-foreground underline-offset-4";
  return (
    <div
      data-slot="ai-inline-citation-source"
      className={cn("flex flex-col gap-1", className)}
      {...props}
    >
      <div className="font-medium">{title ?? host}</div>
      {description ? (
        <p className="text-muted-foreground">{description}</p>
      ) : null}
      {safe ? (
        <a
          href={safe}
          target="_blank"
          rel={EXTERNAL_LINK_REL}
          dir="ltr"
          className={`${linkClass} hover:text-foreground hover:underline focus-visible:underline`}
        >
          {host}
          {newTabLabel ? <span className="sr-only"> {newTabLabel}</span> : null}
        </a>
      ) : (
        <span dir="ltr" className={linkClass}>
          {host}
        </span>
      )}
      {children}
    </div>
  );
}

/** The quoted passage the citation supports. */
function AiInlineCitationQuote({
  className,
  ...props
}: React.ComponentProps<"blockquote">) {
  return (
    <blockquote
      data-slot="ai-inline-citation-quote"
      className={cn(
        "border-s-2 ps-3 text-sm text-muted-foreground italic",
        className,
      )}
      {...props}
    />
  );
}

export {
  AiInlineCitation,
  AiInlineCitationCard,
  AiInlineCitationCardBody,
  AiInlineCitationCardTrigger,
  type AiInlineCitationCardTriggerProps,
  AiInlineCitationQuote,
  AiInlineCitationSource,
  type AiInlineCitationSourceProps,
  AiInlineCitationText,
  citationHostname,
};
