"use client";

import { Wrench01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { cn } from "cn";
import * as React from "react";

import {
  AiChainOfThought,
  AiChainOfThoughtContent,
  AiChainOfThoughtHeader,
} from "@/shared/ui/ai-chain-of-thought";
import { Alert, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { CodeBlock } from "@/shared/ui/code-block";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/shared/ui/item";
import type { TraceStatus } from "@/shared/ui/trace";

/** Lifecycle of a tool call (the AI SDK tool-part states). */
type AiToolState =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-error"
  | "output-denied";

const STATE_STATUS: Record<AiToolState, TraceStatus> = {
  "input-streaming": "running",
  "input-available": "running",
  "approval-requested": "pending",
  "approval-responded": "running",
  "output-available": "success",
  "output-error": "error",
  "output-denied": "skipped",
};

/** Line status of a tool state: running, pending (awaiting approval), success, error, skipped (denied). */
function aiToolStatus(state: AiToolState): TraceStatus {
  return STATE_STATUS[state];
}

/** One tool call as a collapsible line with its input and output. */
function AiTool(props: React.ComponentProps<typeof AiChainOfThought>) {
  return <AiChainOfThought data-slot="ai-tool" {...props} />;
}

interface AiToolHeaderProps
  extends Omit<
    React.ComponentProps<typeof AiChainOfThoughtHeader>,
    "children" | "status"
  > {
  state: AiToolState;
  /** Tensed by the caller: "Running ls", "Ran ls", "Failed to run ls", "Denied ls". */
  title: string;
  icon?: IconSvgElement;
}

function AiToolHeader({
  state,
  title,
  icon = Wrench01Icon,
  ...props
}: AiToolHeaderProps) {
  return (
    <AiChainOfThoughtHeader
      data-slot="ai-tool-header"
      data-state={state}
      icon={icon}
      status={aiToolStatus(state)}
      {...props}
    >
      {title}
    </AiChainOfThoughtHeader>
  );
}

function AiToolContent(
  props: React.ComponentProps<typeof AiChainOfThoughtContent>,
) {
  return <AiChainOfThoughtContent data-slot="ai-tool-content" {...props} />;
}

function toCode(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

interface AiToolSectionProps
  extends Omit<React.ComponentProps<"div">, "children"> {
  /** Visible heading, e.g. "Parameters" / "Result". */
  label: string;
  /** Accessible name of the copy button; hidden without it. */
  copyLabel?: string;
  copiedLabel?: string;
}

function ToolSection({
  label,
  className,
  children,
  ...props
}: Omit<AiToolSectionProps, "copyLabel" | "copiedLabel"> & {
  children: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <div
      role="group"
      aria-labelledby={id}
      className={cn("flex flex-col gap-1", className)}
      {...props}
    >
      <span id={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

interface AiToolInputProps extends AiToolSectionProps {
  /** Tool arguments; objects are shown as formatted JSON. */
  input: unknown;
}

function AiToolInput({
  input,
  copyLabel,
  copiedLabel,
  ...props
}: AiToolInputProps) {
  return (
    <ToolSection data-slot="ai-tool-input" {...props}>
      <CodeBlock
        code={toCode(input)}
        language="json"
        copyLabel={copyLabel}
        copiedLabel={copiedLabel}
        className="max-h-64 overflow-auto"
      />
    </ToolSection>
  );
}

interface AiToolOutputProps extends AiToolSectionProps {
  /** A React node is rendered as is; any other value as code. */
  output?: unknown;
  /** The tool failed: shown instead of the output. */
  errorText?: string;
}

function AiToolOutput({
  output,
  errorText,
  copyLabel,
  copiedLabel,
  ...props
}: AiToolOutputProps) {
  if (errorText == null && output == null) {
    return null;
  }
  let body: React.ReactNode;
  if (errorText != null) {
    body = (
      <Alert variant="destructive">
        <AlertTitle className="font-mono text-xs font-normal break-words">
          {errorText}
        </AlertTitle>
      </Alert>
    );
  } else if (React.isValidElement(output)) {
    body = output;
  } else {
    body = (
      <CodeBlock
        code={toCode(output)}
        copyLabel={copyLabel}
        copiedLabel={copiedLabel}
        defaultWrap
        className="max-h-64 overflow-auto"
      />
    );
  }
  return (
    <ToolSection data-slot="ai-tool-output" {...props}>
      {body}
    </ToolSection>
  );
}

interface AiToolApprovalProps
  extends Omit<React.ComponentProps<typeof Item>, "title"> {
  /** "Run ls -la?" */
  title: React.ReactNode;
  description?: React.ReactNode;
  approveLabel: string;
  denyLabel: string;
  onApprove: () => void;
  onDeny: () => void;
  icon?: IconSvgElement;
}

/** The `approval-requested` state: not a line but a card with Approve and Deny. */
function AiToolApproval({
  title,
  description,
  approveLabel,
  denyLabel,
  onApprove,
  onDeny,
  icon = Wrench01Icon,
  ...props
}: AiToolApprovalProps) {
  return (
    <Item data-slot="ai-tool-approval" variant="outline" size="sm" {...props}>
      <ItemMedia variant="icon">
        <HugeiconsIcon icon={icon} strokeWidth={2} aria-hidden="true" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{title}</ItemTitle>
        {description ? <ItemDescription>{description}</ItemDescription> : null}
      </ItemContent>
      <ItemActions>
        <Button variant="outline" size="sm" onClick={onDeny}>
          {denyLabel}
        </Button>
        <Button size="sm" onClick={onApprove}>
          {approveLabel}
        </Button>
      </ItemActions>
    </Item>
  );
}

export {
  AiTool,
  AiToolApproval,
  type AiToolApprovalProps,
  AiToolContent,
  AiToolHeader,
  type AiToolHeaderProps,
  AiToolInput,
  type AiToolInputProps,
  AiToolOutput,
  type AiToolOutputProps,
  type AiToolState,
  aiToolStatus,
};
