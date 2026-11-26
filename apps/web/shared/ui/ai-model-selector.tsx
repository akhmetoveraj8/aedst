"use client";

import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "cn";
import type * as React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { InputGroupButton } from "@/shared/ui/input-group";

// Picks the model (or effort) the agent runs with (shadcn AI Elements
// "Model Selector", Base UI pattern). A dropdown menu of radio items whose
// trigger is a small input-group button, so it sits in the prompt input's
// footer. Searching a long model list belongs in `command`, not here.

function AiModelSelector(props: React.ComponentProps<typeof DropdownMenu>) {
  return <DropdownMenu {...props} />;
}

type AiModelSelectorTriggerProps = Omit<
  React.ComponentProps<typeof DropdownMenuTrigger>,
  "render"
>;

/** The current model's name with a chevron; opens the menu. */
function AiModelSelectorTrigger({
  className,
  children,
  ...props
}: AiModelSelectorTriggerProps) {
  return (
    <DropdownMenuTrigger
      render={<InputGroupButton size="sm" />}
      className={cn("data-popup-open:bg-muted", className)}
      {...props}
    >
      {children}
      <HugeiconsIcon
        icon={ArrowDown01Icon}
        strokeWidth={2}
        aria-hidden="true"
        className="size-3.5 text-muted-foreground"
      />
    </DropdownMenuTrigger>
  );
}

function AiModelSelectorContent({
  align = "start",
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      align={align}
      className={cn("w-auto min-w-48", className)}
      {...props}
    />
  );
}

/** Radio group holding the selected model as its value. */
function AiModelSelectorList(
  props: React.ComponentProps<typeof DropdownMenuRadioGroup>,
) {
  return <DropdownMenuRadioGroup {...props} />;
}

type AiModelSelectorGroupProps = React.ComponentProps<
  typeof DropdownMenuGroup
> & {
  /** Visible heading of the group, e.g. the provider name. */
  heading?: React.ReactNode;
};

function AiModelSelectorGroup({
  heading,
  children,
  ...props
}: AiModelSelectorGroupProps) {
  return (
    <DropdownMenuGroup {...props}>
      {heading ? <DropdownMenuLabel>{heading}</DropdownMenuLabel> : null}
      {children}
    </DropdownMenuGroup>
  );
}

/** One model; picking it closes the menu. */
function AiModelSelectorItem({
  closeOnClick = true,
  ...props
}: React.ComponentProps<typeof DropdownMenuRadioItem>) {
  return <DropdownMenuRadioItem closeOnClick={closeOnClick} {...props} />;
}

function AiModelSelectorSeparator(
  props: React.ComponentProps<typeof DropdownMenuSeparator>,
) {
  return <DropdownMenuSeparator {...props} />;
}

function AiModelSelectorShortcut(
  props: React.ComponentProps<typeof DropdownMenuShortcut>,
) {
  return <DropdownMenuShortcut {...props} />;
}

/** Slot for a provider logo (an icon the app supplies; nothing is fetched). */
function AiModelSelectorLogo({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="ai-model-selector-logo"
      aria-hidden="true"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center [&_img]:size-full [&_svg]:size-full",
        className,
      )}
      {...props}
    />
  );
}

/** Overlapping row of logos, e.g. the providers that serve one model. */
function AiModelSelectorLogoGroup({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="ai-model-selector-logo-group"
      className={cn(
        "flex shrink-0 items-center *:not-first:-ms-1 *:rounded-full *:bg-background *:ring-1 *:ring-background",
        className,
      )}
      {...props}
    />
  );
}

function AiModelSelectorName({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="ai-model-selector-name"
      className={cn("min-w-0 flex-1 truncate text-start", className)}
      {...props}
    />
  );
}

export {
  AiModelSelector,
  AiModelSelectorContent,
  AiModelSelectorGroup,
  AiModelSelectorItem,
  AiModelSelectorList,
  AiModelSelectorLogo,
  AiModelSelectorLogoGroup,
  AiModelSelectorName,
  AiModelSelectorSeparator,
  AiModelSelectorShortcut,
  AiModelSelectorTrigger,
};
