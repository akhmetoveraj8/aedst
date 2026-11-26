"use client";

import {
  Cancel01Icon,
  FileCodeIcon,
  FlaskConicalIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "cn";
import type * as React from "react";

import {
  AiChainOfThought,
  AiChainOfThoughtContent,
  AiChainOfThoughtHeader,
  type AiChainOfThoughtHeaderProps,
  type AiChainOfThoughtProps,
  AiChainOfThoughtStep,
} from "@/shared/ui/ai-chain-of-thought";
import { CodeBlock } from "@/shared/ui/code-block";
import { Progress, ProgressLabel, ProgressValue } from "@/shared/ui/progress";
import type { TraceStatus } from "@/shared/ui/trace";

type AiTestStatus = "passed" | "failed" | "skipped" | "running";

interface AiTestCounts {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

const TEST_STATUS: Record<AiTestStatus, TraceStatus> = {
  passed: "success",
  failed: "error",
  skipped: "skipped",
  running: "running",
};

/** Totals for a summary the caller words ("Ran 5 tests, 1 failed"). */
function countTests(tests: readonly { status: AiTestStatus }[]): AiTestCounts {
  const counts: AiTestCounts = { total: 0, passed: 0, failed: 0, skipped: 0 };
  for (const test of tests) {
    counts.total += 1;
    if (test.status !== "running") {
      counts[test.status] += 1;
    }
  }
  return counts;
}

/** A test run: a summary line that opens into suites and tests. */
function AiTestResults(props: AiChainOfThoughtProps) {
  return <AiChainOfThought data-slot="ai-test-results" {...props} />;
}

interface AiTestResultsHeaderProps
  extends Omit<AiChainOfThoughtHeaderProps, "status"> {
  status: AiTestStatus;
}

/** The summary line, worded by the caller; `failed` shows the error status. */
function AiTestResultsHeader({
  status,
  icon = FlaskConicalIcon,
  ...props
}: AiTestResultsHeaderProps) {
  return (
    <AiChainOfThoughtHeader
      data-slot="ai-test-results-header"
      icon={icon}
      status={
        TEST_STATUS[status] === "success" ? undefined : TEST_STATUS[status]
      }
      {...props}
    />
  );
}

function AiTestResultsContent(
  props: React.ComponentProps<typeof AiChainOfThoughtContent>,
) {
  return (
    <AiChainOfThoughtContent data-slot="ai-test-results-content" {...props} />
  );
}

interface AiTestResultsProgressProps
  extends Omit<React.ComponentProps<typeof Progress>, "value" | "max"> {
  counts: AiTestCounts;
  /** Visible label, e.g. "Passed". */
  label: string;
}

/** Share of passed tests as a progress bar with a label and percentage. */
function AiTestResultsProgress({
  counts,
  label,
  className,
  ...props
}: AiTestResultsProgressProps) {
  return (
    <Progress
      data-slot="ai-test-results-progress"
      value={counts.passed}
      max={Math.max(counts.total, 1)}
      className={cn("px-2", className)}
      {...props}
    >
      <ProgressLabel>{label}</ProgressLabel>
      <ProgressValue />
    </Progress>
  );
}

interface AiTestSuiteProps extends Omit<AiChainOfThoughtProps, "children"> {
  /** Suite title with its counts, e.g. "payment.test.ts, 2 tests, 1 failed". */
  name: React.ReactNode;
  status: AiTestStatus;
  /** The suite's `AiTest`s. */
  children: React.ReactNode;
  statusLabel?: string;
}

/** A file of tests; suites with a failure open by default. */
function AiTestSuite({
  name,
  status,
  statusLabel,
  defaultOpen,
  children,
  ...props
}: AiTestSuiteProps) {
  return (
    <li data-slot="ai-test-suite" data-status={status}>
      <AiChainOfThought
        defaultOpen={defaultOpen ?? status === "failed"}
        {...props}
      >
        <AiChainOfThoughtHeader
          icon={FileCodeIcon}
          status={
            status === "failed" || status === "running"
              ? TEST_STATUS[status]
              : undefined
          }
          statusLabel={statusLabel}
        >
          {name}
        </AiChainOfThoughtHeader>
        <AiChainOfThoughtContent>
          <ul className="flex flex-col">{children}</ul>
        </AiChainOfThoughtContent>
      </AiChainOfThought>
    </li>
  );
}

/** The list of `AiTestSuite`s inside `AiTestResultsContent`. */
function AiTestSuites({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="ai-test-suites"
      className={cn("flex flex-col", className)}
      {...props}
    />
  );
}

interface AiTestProps {
  name: React.ReactNode;
  status: AiTestStatus;
  /** Failure message; a failed test with one is a collapsible line. */
  error?: string;
  /** Already formatted, e.g. "12 ms". */
  duration?: string;
  /** Visually hidden status in words, e.g. "Failed". */
  statusLabel?: string;
  /** Accessible name of the copy button of the error. */
  copyLabel?: string;
  copiedLabel?: string;
}

function AiTest({
  name,
  status,
  error,
  duration,
  statusLabel,
  copyLabel,
  copiedLabel,
}: AiTestProps) {
  if (status === "failed" && error) {
    return (
      <li data-slot="ai-test" data-status={status}>
        <AiChainOfThought defaultOpen>
          <AiChainOfThoughtHeader
            icon={Cancel01Icon}
            status="error"
            statusLabel={statusLabel}
            description={duration}
          >
            {name}
          </AiChainOfThoughtHeader>
          <AiChainOfThoughtContent>
            <CodeBlock
              code={error}
              copyLabel={copyLabel}
              copiedLabel={copiedLabel}
              disableHighlight
              defaultWrap
              className="max-h-64 overflow-auto text-xs"
            />
          </AiChainOfThoughtContent>
        </AiChainOfThought>
      </li>
    );
  }
  return (
    <AiChainOfThoughtStep
      data-slot="ai-test"
      status={TEST_STATUS[status]}
      statusLabel={statusLabel}
      label={name}
      description={duration}
    />
  );
}

export {
  AiTest,
  type AiTestCounts,
  type AiTestProps,
  AiTestResults,
  AiTestResultsContent,
  AiTestResultsHeader,
  type AiTestResultsHeaderProps,
  AiTestResultsProgress,
  type AiTestResultsProgressProps,
  type AiTestStatus,
  AiTestSuite,
  type AiTestSuiteProps,
  AiTestSuites,
  countTests,
};
